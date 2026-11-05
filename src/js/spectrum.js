/** Rama de lectura. Su salida nunca se conecta a destination. */
export function spectrumTap(context, output) {
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024; analyser.smoothingTimeConstant = .78;
  analyser.minDecibels = -80; analyser.maxDecibels = -20;
  const data = new Uint8Array(analyser.frequencyBinCount);
  output.connect(analyser);
  let closed = false;
  return {
    sampleRate: context.sampleRate, fftSize: analyser.fftSize,
    read() { if (closed) return null; analyser.getByteFrequencyData(data); return data; },
    close() { if (closed) return; closed = true; output.disconnect(analyser); analyser.disconnect(); },
  };
}

export function frequencyRanges(sampleRate, fftSize, count = 32) {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isInteger(fftSize) || fftSize < 4 || !Number.isInteger(count) || count < 1 || count > 64) return [];
  const bins = Math.floor(fftSize/2), max = Math.min(16000,sampleRate/2), min = Math.min(60,max/2);
  return Array.from({length:count},(_,i) => {
    const start = Math.max(1,Math.min(bins-1,Math.floor(min*(max/min)**(i/count)*fftSize/sampleRate)));
    const end = Math.max(start+1,Math.min(bins,Math.ceil(min*(max/min)**((i+1)/count)*fftSize/sampleRate)));
    return [start,end];
  });
}
export function spectrumLevels(data, ranges, target = new Float32Array(ranges.length)) {
  for (let i=0;i<ranges.length;i++) {
    const [start,end] = ranges[i]; let squares = 0, count = 0;
    for (let j=start;j<Math.min(end,data.length);j++) { squares += (data[j]/255)**2; count++; }
    target[i] = count ? Math.min(1,Math.sqrt(squares/count)) : 0;
  }
  return target;
}
export function shouldDrawSpectrum({enabled,focus,visible,playing,loading,motion,available}) {
  return Boolean(enabled && focus && visible && playing && !loading && motion && available);
}
