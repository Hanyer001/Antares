import AVFoundation
import MediaPlayer
import Tauri
import UIKit

private struct Track: Decodable {
    let id: String
    let url: String
    let title: String?
    let artist: String?
    let duration: Double?
    let artwork: String?

    var streamURL: URL? {
        guard let value = URL(string: url), value.scheme == "https",
              let host = value.host, host == "googlevideo.com" || host.hasSuffix(".googlevideo.com"),
              value.user == nil, value.password == nil else { return nil }
        return value
    }
}

private struct QueueArgs: Decodable {
    let currentId: String
    let items: [Track]
    let previous: Track?
}
private struct SeekArgs: Decodable { let seconds: Double }
private struct VolumeArgs: Decodable { let volume: Float }
private struct RepeatArgs: Decodable { let `repeat`: String }
private struct SleepArgs: Decodable { let mode: String; let milliseconds: Double? }

final class PlayerPlugin: Plugin {
    private let player = AVQueuePlayer()
    private let session = AVAudioSession.sharedInstance()
    private var tracks: [ObjectIdentifier: Track] = [:]
    private var previous: Track?
    private var intent = false
    private var interrupted = false
    private var repeatOne = false
    private var stopAtEnd = false
    private var sleepTimer: Timer?
    private var sequence = 0
    private var configured = false
    private var activeItem: AVPlayerItem?
    private var itemStatus: NSKeyValueObservation?
    private var observers: [NSKeyValueObservation] = []
    private var notifications: [NSObjectProtocol] = []
    private var timeObserver: Any?
    private var manualChange = false
    private var finishedItem: AVPlayerItem?
    private var artworkTask: URLSessionDataTask?
    private var artwork: MPMediaItemArtwork?

    // All transport, observations and plugin events are serialized on main.
    private func perform(_ invoke: Invoke, _ action: @escaping () throws -> Void) {
        DispatchQueue.main.async {
            do { try action(); invoke.resolve() }
            catch { invoke.reject(error.localizedDescription) }
        }
    }

    private func configure() {
        guard !configured else { return }
        configured = true
        player.actionAtItemEnd = .advance
        observers = [
            player.observe(\.currentItem, options: [.new]) { [weak self] _, _ in
                DispatchQueue.main.async { self?.observeItem() }
            },
            player.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
                DispatchQueue.main.async { self?.publish() }
            },
        ]
        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main
        ) { [weak self] _ in self?.tick() }

        let center = NotificationCenter.default
        notifications = [
            center.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: nil, queue: .main) { [weak self] note in
                self?.ended(note.object as? AVPlayerItem)
            },
            center.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { [weak self] note in
                self?.handleInterruption(note)
            },
            center.addObserver(forName: AVAudioSession.routeChangeNotification, object: session, queue: .main) { [weak self] note in
                if note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue {
                    self?.pauseTransport()
                    self?.trigger("interruption", data: ["reason": "audio-route"])
                }
            },
        ]

        let remote = MPRemoteCommandCenter.shared()
        remote.playCommand.addTarget { [weak self] _ in
            self?.remote { try $0.startTransport() } ?? .commandFailed
        }
        remote.pauseCommand.addTarget { [weak self] _ in
            self?.remote { $0.pauseTransport() } ?? .commandFailed
        }
        remote.togglePlayPauseCommand.addTarget { [weak self] _ in
            self?.remote { if $0.intent { $0.pauseTransport() } else { try $0.startTransport() } } ?? .commandFailed
        }
        remote.nextTrackCommand.addTarget { [weak self] _ in
            self?.remote { plugin in
                guard plugin.player.items().count > 1 else { return }
                plugin.manualChange = true
                plugin.player.advanceToNextItem()
                plugin.observeItem()
            } ?? .commandFailed
        }
        remote.previousTrackCommand.addTarget { [weak self] _ in
            self?.remote { plugin in
                if plugin.player.currentTime().seconds > 3 || plugin.previous == nil {
                    plugin.seekTo(0)
                    return
                }
                guard let track = plugin.previous, let url = track.streamURL else { return }
                plugin.manualChange = true
                plugin.replace(track, url: url, announce: true)
                if plugin.intent { try plugin.startTransport() }
            } ?? .commandFailed
        }
        remote.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            return self?.remote { $0.seekTo(event.positionTime) } ?? .commandFailed
        }
    }

    private func remote(_ action: @escaping (PlayerPlugin) throws -> Void) -> MPRemoteCommandHandlerStatus {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.player.currentItem != nil else { return }
            do { try action(self) }
            catch { self.reportError("No se pudo iniciar la sesión de audio.") }
        }
        return .success
    }

    private func startTransport() throws {
        guard player.currentItem != nil else { return }
        try session.setCategory(.playback, mode: .default, policy: .longFormAudio, options: [])
        try session.setActive(true)
        intent = true
        interrupted = false
        player.play()
        publish()
    }

    private func pauseTransport() {
        intent = false
        interrupted = false
        player.pause()
        publish()
    }

    private func handleInterruption(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let kind = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        if kind == .began {
            if intent { trigger("interruption", data: ["reason": "audio-focus"]) }
            interrupted = intent
            player.pause()
            publish()
        } else if interrupted {
            interrupted = false
            let options = AVAudioSession.InterruptionOptions(rawValue:
                note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
            if intent && options.contains(.shouldResume) {
                do { try startTransport() }
                catch { reportError("No se pudo retomar después de la interrupción.") }
            } else { pauseTransport() }
        }
    }

    private func replace(_ track: Track, url: URL, announce: Bool) {
        player.removeAllItems()
        tracks.removeAll()
        previous = nil
        activeItem = nil
        let item = AVPlayerItem(url: url)
        tracks[ObjectIdentifier(item)] = track
        player.insert(item, after: nil)
        observeItem(announce: announce)
    }

    private func observeItem(announce: Bool = true) {
        guard let item = player.currentItem, item !== activeItem,
              let track = tracks[ObjectIdentifier(item)] else { return }
        let old = activeItem.flatMap { tracks[ObjectIdentifier($0)] }
        activeItem = item
        finishedItem = nil
        if let old, old.id != track.id { previous = old }
        let activeKeys = Set(player.items().map { ObjectIdentifier($0) })
        tracks = tracks.filter { activeKeys.contains($0.key) }
        itemStatus = item.observe(\.status, options: [.initial, .new]) { [weak self, weak item] _, _ in
            DispatchQueue.main.async {
                guard let self, let item, item === self.player.currentItem else { return }
                if item.status == .failed { self.reportError("No se pudo leer esta fuente de audio.") }
                else { self.publishTime(); self.publish() }
            }
        }
        if announce {
            trigger("item", data: [
                "id": track.id, "title": track.title ?? "", "uploader": track.artist ?? "",
                "duration": duration(item, track), "completed": !manualChange,
            ])
        }
        manualChange = false
        loadArtwork(track)
        publishTime()
        publish()
    }

    private func ended(_ item: AVPlayerItem?) {
        guard let item, item === activeItem, item !== finishedItem,
              let track = tracks[ObjectIdentifier(item)] else { return }
        if !repeatOne && !stopAtEnd && player.currentItem !== item && player.currentItem != nil {
            observeItem()
            return
        }
        if !repeatOne && !stopAtEnd && player.items().count > 1 { return }
        finish(item, track)
    }

    private func finish(_ item: AVPlayerItem, _ track: Track) {
        guard item !== finishedItem else { return }
        finishedItem = item
        if stopAtEnd {
            pauseTransport()
            stopAtEnd = false
            updateActionAtEnd()
            trigger("sleep", data: ["id": track.id])
        } else if repeatOne && intent {
            player.seek(to: .zero) { [weak self, weak item] done in
                DispatchQueue.main.async {
                    guard let self, let item, item === self.player.currentItem else { return }
                    self.finishedItem = nil
                    if done && self.intent { self.player.play() }
                }
            }
        } else if player.currentItem === item && player.items().count > 1 {
            player.advanceToNextItem()
            observeItem()
        } else {
            intent = false
            player.pause()
            emitState(id: track.id, ended: true)
            updateNowPlaying()
        }
    }

    private func tick() {
        guard let item = player.currentItem, let track = tracks[ObjectIdentifier(item)] else { return }
        if intent && !interrupted, let expected = track.duration, expected > 0,
           item.currentTime().seconds >= expected + 1, usesCatalogDuration(item, track) {
            // Fragmented AAC can report a duration longer than the actual song.
            finish(item, track)
            return
        }
        publishTime()
    }

    private func updateActionAtEnd() {
        player.actionAtItemEnd = repeatOne || stopAtEnd ? .pause : .advance
    }

    private func seekTo(_ seconds: Double) {
        guard seconds.isFinite, seconds >= 0, player.currentItem != nil else { return }
        let limit = player.currentItem.flatMap { item in tracks[ObjectIdentifier(item)].map { duration(item, $0) } } ?? 0
        let target = limit > 0 ? min(seconds, limit) : seconds
        if target < limit { finishedItem = nil }
        player.seek(to: CMTime(seconds: target, preferredTimescale: 600)) { [weak self] _ in
            DispatchQueue.main.async { self?.publishTime(); self?.updateNowPlaying() }
        }
    }

    private func usesCatalogDuration(_ item: AVPlayerItem, _ track: Track) -> Bool {
        guard let expected = track.duration, expected.isFinite && expected > 0 else { return false }
        let measured = item.duration.seconds
        return !measured.isFinite || measured <= 0 || measured - expected > max(5, expected * 0.25)
    }

    private func duration(_ item: AVPlayerItem, _ track: Track) -> Double {
        if usesCatalogDuration(item, track) { return track.duration ?? 0 }
        let value = item.duration.seconds
        return value.isFinite && value > 0 ? value : 0
    }

    private func publishTime() {
        guard let item = player.currentItem, let track = tracks[ObjectIdentifier(item)] else { return }
        let time = item.currentTime().seconds
        let end = item.loadedTimeRanges.last.map { CMTimeRangeGetEnd($0.timeRangeValue).seconds } ?? 0
        let total = duration(item, track)
        let position = time.isFinite ? (total > 0 ? min(time, total) : time) : 0
        trigger("time", data: [
            "id": track.id, "position": position,
            "duration": total, "buffered": end.isFinite ? min(end, total > 0 ? total : end) : 0,
        ])
    }

    private func publish() {
        guard let item = player.currentItem, let track = tracks[ObjectIdentifier(item)] else { return }
        emitState(id: track.id)
        updateNowPlaying()
    }

    private func emitState(id: String, ended: Bool = false) {
        sequence += 1
        trigger("state", data: [
            "id": id, "sequence": sequence, "playing": player.timeControlStatus == .playing,
            "playWhenReady": intent, "buffering": !interrupted && player.timeControlStatus == .waitingToPlayAtSpecifiedRate,
            "ended": ended,
        ])
    }

    private func reportError(_ message: String) {
        guard let item = player.currentItem, let track = tracks[ObjectIdentifier(item)] else { return }
        trigger("error", data: ["id": track.id, "message": message])
    }

    private func loadArtwork(_ track: Track) {
        artworkTask?.cancel()
        artwork = nil
        guard let path = track.artwork, let url = URL(string: path),
              url.scheme == "https", url.host == "i.ytimg.com" else { return }
        artworkTask = URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let data, let image = UIImage(data: data) else { return }
            DispatchQueue.main.async {
                guard let self, let item = self.player.currentItem,
                      self.tracks[ObjectIdentifier(item)]?.id == track.id else { return }
                self.artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                self.updateNowPlaying()
            }
        }
        artworkTask?.resume()
    }

    private func updateNowPlaying() {
        guard let item = player.currentItem, let track = tracks[ObjectIdentifier(item)] else { return }
        let time = item.currentTime().seconds
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: track.title ?? "Antares",
            MPMediaItemPropertyArtist: track.artist ?? "",
            MPMediaItemPropertyPlaybackDuration: duration(item, track),
            MPNowPlayingInfoPropertyElapsedPlaybackTime: time.isFinite ? time : 0,
            MPNowPlayingInfoPropertyPlaybackRate: player.rate,
        ]
        if let artwork { info[MPMediaItemPropertyArtwork] = artwork }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        MPRemoteCommandCenter.shared().nextTrackCommand.isEnabled = player.items().count > 1
    }

    @objc func load(_ invoke: Invoke) {
        perform(invoke) {
            let track = try invoke.parseArgs(Track.self)
            guard let url = track.streamURL else { throw NSError(domain: "Antares", code: 1, userInfo: [NSLocalizedDescriptionKey: "Fuente AAC no válida."]) }
            self.configure()
            self.pauseTransport()
            self.replace(track, url: url, announce: false)
        }
    }
    @objc func play(_ invoke: Invoke) { perform(invoke) { try self.startTransport() } }
    @objc func pause(_ invoke: Invoke) { perform(invoke) { self.pauseTransport() } }
    @objc func seek(_ invoke: Invoke) { perform(invoke) { self.seekTo(try invoke.parseArgs(SeekArgs.self).seconds) } }
    @objc func setVolume(_ invoke: Invoke) {
        perform(invoke) { self.player.volume = max(0, min(1, try invoke.parseArgs(VolumeArgs.self).volume)) }
    }
    @objc func setRepeat(_ invoke: Invoke) {
        perform(invoke) {
            self.repeatOne = try invoke.parseArgs(RepeatArgs.self).repeat == "one"
            self.updateActionAtEnd()
        }
    }
    @objc func setSleep(_ invoke: Invoke) {
        perform(invoke) {
            let args = try invoke.parseArgs(SleepArgs.self)
            self.sleepTimer?.invalidate()
            self.stopAtEnd = args.mode == "track"
            self.updateActionAtEnd()
            if args.mode == "time", let milliseconds = args.milliseconds, milliseconds > 0 {
                self.sleepTimer = Timer.scheduledTimer(withTimeInterval: milliseconds / 1000, repeats: false) { [weak self] _ in
                    self?.pauseTransport()
                    self?.trigger("sleep", data: [:])
                }
            }
        }
    }
    @objc func syncQueue(_ invoke: Invoke) {
        perform(invoke) {
            let args = try invoke.parseArgs(QueueArgs.self)
            guard let current = self.player.currentItem,
                  self.tracks[ObjectIdentifier(current)]?.id == args.currentId else { return }
            self.previous = args.previous ?? self.previous
            var desired = args.items.prefix(3).compactMap { track in track.streamURL.map { (track, $0) } }
            let existing = Array(self.player.items().dropFirst())
            // Reuse already buffered items for the common prefix.
            var keep = 0
            while keep < min(existing.count, desired.count),
                  self.tracks[ObjectIdentifier(existing[keep])]?.id == desired[keep].0.id { keep += 1 }
            for item in existing.dropFirst(keep) {
                self.player.remove(item)
                self.tracks.removeValue(forKey: ObjectIdentifier(item))
            }
            desired.removeFirst(keep)
            for (track, url) in desired {
                let item = AVPlayerItem(url: url)
                let tail = self.player.items().last
                guard self.player.canInsert(item, after: tail) else { break }
                self.tracks[ObjectIdentifier(item)] = track
                self.player.insert(item, after: tail)
            }
            self.updateNowPlaying()
        }
    }
    @objc func stop(_ invoke: Invoke) {
        perform(invoke) {
            self.pauseTransport()
            self.player.removeAllItems()
            self.activeItem = nil
            self.tracks.removeAll()
            self.previous = nil
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            try? self.session.setActive(false, options: .notifyOthersOnDeactivation)
        }
    }
}

@_cdecl("init_plugin_antares_ios")
func initAntaresPlayer() -> Plugin { PlayerPlugin() }
