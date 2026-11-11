//! Per-user, local command bridge. Never accepts code, paths or arbitrary URLs.
#[cfg(any(target_os = "linux", test))]
use serde::Deserialize;
use serde::Serialize;
use std::{collections::VecDeque, sync::{mpsc, Mutex}};
#[cfg(target_os = "linux")]
use tauri::{Emitter, Manager};

#[derive(Clone, Serialize)]
pub struct Request { id: String, command: String, query: String }
struct Job { request: Request, reply: mpsc::Sender<serde_json::Value> }
#[derive(Default)]
pub struct Bridge { jobs: Mutex<VecDeque<Job>>, active: Mutex<Option<Job>> }
#[cfg(any(target_os = "linux", test))]
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Input { command: String, #[serde(default)] query: String }
#[cfg(any(target_os = "linux", test))]
impl Input {
    fn valid(&self) -> bool {
        match self.command.as_str() {
            "play_query" => !self.query.trim().is_empty() && self.query.chars().count()<=250 && !self.query.chars().any(char::is_control),
            "pause" | "resume" | "next" | "previous" | "status" => self.query.is_empty(),
            _ => false,
        }
    }
}
#[tauri::command]
pub fn take_voice_request(state: tauri::State<Bridge>) -> Option<Request> {
    let mut active=state.active.lock().ok()?;
    if active.is_some() { return None; }
    *active=state.jobs.lock().ok()?.pop_front();
    active.as_ref().map(|job|job.request.clone())
}
#[tauri::command]
pub fn finish_voice_request(state: tauri::State<Bridge>, id: String, result: serde_json::Value) -> Result<(),String> {
    let mut active=state.active.lock().map_err(|_|"Voice bridge unavailable")?;
    if active.as_ref().is_none_or(|job|job.request.id!=id) { return Err("Unknown voice request".into()); }
    let job=active.take().unwrap();
    let _=job.reply.send(result);
    Ok(())
}

#[cfg(target_os="linux")]
fn wait_reply(receiver: &mpsc::Receiver<serde_json::Value>, stream: &mut std::os::unix::net::UnixStream, timeout: std::time::Duration) -> Option<serde_json::Value> {
    use std::{io::{Read,ErrorKind},time::{Duration,Instant}};
    let start=Instant::now();
    loop {
        match receiver.recv_timeout(Duration::from_millis(50)) {
            Ok(value) => return Some(value),
            Err(mpsc::RecvTimeoutError::Disconnected) => return None,
            Err(mpsc::RecvTimeoutError::Timeout) => {},
        }
        if start.elapsed()>=timeout { return None; }
        // Closing the caller's socket cancels pending playback, including after
        // timeout. No extra public command or parallel network endpoint.
        if stream.set_nonblocking(true).is_err() { return None; }
        let read=stream.read(&mut [0u8;1]);
        let _=stream.set_nonblocking(false);
        match read {
            Err(error) if error.kind()==ErrorKind::WouldBlock => {},
            _ => return None,
        }
    }
}

#[cfg(target_os="linux")]
pub fn start(app: tauri::AppHandle) -> std::io::Result<()> {
    use std::{io::{BufRead,BufReader,Write}, os::unix::{fs::PermissionsExt,net::{UnixListener,UnixStream}}, time::Duration};
    let Some(runtime)=std::env::var_os("XDG_RUNTIME_DIR") else { return Ok(()); };
    let directory=std::path::PathBuf::from(runtime).join("antares-voice");
    std::fs::create_dir_all(&directory)?;
    std::fs::set_permissions(&directory,std::fs::Permissions::from_mode(0o700))?;
    let path=directory.join("control.sock");
    if path.exists() {
        if UnixStream::connect(&path).is_ok() { return Ok(()); }
        std::fs::remove_file(&path)?;
    }
    let listener=UnixListener::bind(&path)?;
    std::fs::set_permissions(&path,std::fs::Permissions::from_mode(0o600))?;
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream)=stream else { break; };
            let _=stream.set_read_timeout(Some(Duration::from_secs(2)));
            let _=stream.set_write_timeout(Some(Duration::from_secs(2)));
            let mut line=String::new();
            let read={ use std::io::Read; BufReader::new(&stream).take(4097).read_line(&mut line) };
            let input=read.ok().filter(|size|*size<=4096).and_then(|_|serde_json::from_str::<Input>(&line).ok()).filter(Input::valid);
            let response=if let Some(input)=input {
                let id=uuid::Uuid::new_v4().to_string();
                let (sender,receiver)=mpsc::channel();
                let state=app.state::<Bridge>();
                state.jobs.lock().unwrap().push_back(Job { request:Request {id:id.clone(),command:input.command,query:input.query},reply:sender });
                let _=app.emit("voice-request",());
                let response=wait_reply(&receiver,&mut stream,Duration::from_secs(50));
                let cancelled=response.is_none();
                let response=response.unwrap_or_else(||serde_json::json!({"ok":false,"error":"Petición cancelada o caducada.","code":"cancelled"}));
                state.jobs.lock().unwrap().retain(|job|job.request.id!=id);
                let mut active=state.active.lock().unwrap();
                if active.as_ref().is_some_and(|job|job.request.id==id) { *active=None; }
                drop(active);
                if cancelled { let _=app.emit("voice-cancelled",&id); }
                response
            } else { serde_json::json!({"ok":false,"error":"Orden multimedia inválida."}) };
            let _=writeln!(stream,"{}",response);
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_finite_controls_and_bounded_queries() {
        for command in ["pause","resume","next","previous","status"] { assert!(Input {command:command.into(),query:String::new()}.valid()); }
        assert!(Input {command:"play_query".into(),query:"Esclava Remix".into()}.valid());
        for (command,query) in [("shell","rm -rf"),("play_query",""),("pause","a"),("play_query","a\nb")] { assert!(!Input {command:command.into(),query:query.into()}.valid()); }
        assert!(!Input {command:"play_query".into(),query:"x".repeat(251)}.valid());
        assert!(serde_json::from_str::<Input>(r#"{"command":"pause","code":"evil"}"#).is_err());
    }
    #[cfg(target_os="linux")]
    #[test]
    fn disconnected_caller_does_not_leave_a_pending_action() {
        use std::{os::unix::net::UnixStream,time::{Duration,Instant}};
        let (mut server,client)=UnixStream::pair().unwrap();
        let (_sender,receiver)=mpsc::channel();
        drop(client);
        let start=Instant::now();
        assert!(wait_reply(&receiver,&mut server,Duration::from_secs(2)).is_none());
        assert!(start.elapsed()<Duration::from_millis(300));
    }
    #[cfg(target_os="linux")]
    #[test]
    fn live_caller_receives_only_the_confirmed_result() {
        use std::{os::unix::net::UnixStream,time::Duration};
        let (mut server,_client)=UnixStream::pair().unwrap();
        let (sender,receiver)=mpsc::channel();
        sender.send(serde_json::json!({"ok":true})).unwrap();
        assert_eq!(wait_reply(&receiver,&mut server,Duration::from_secs(2)).unwrap()["ok"],true);
    }

}
