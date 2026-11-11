use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Default, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    #[default]
    Idle,
    Loading,
    Buffering,
    Playing,
    Paused,
    Offline,
    Recovering,
    Error,
}

#[derive(Deserialize)]
#[serde(tag = "event", content = "args", rename_all = "camelCase")]
pub enum Event {
    Begin(f64),
    Resume(bool),
    Buffering,
    Progress(f64),
    Playing,
    Pause,
    Fail(bool),
    Reconnect,
    RetryFinished(u32, bool, bool),
}

#[derive(Serialize)]
#[serde(tag = "effect", content = "args", rename_all = "camelCase")]
pub enum Effect {
    CancelWatchdog,
    StartWatchdog,
    StateChanged(Phase),
    Waiting,
    Failed,
    Recovered,
    Retry(u32, f64),
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recovery {
    pub state: Phase,
    pub position: f64,
    pub intent: bool,
    pub in_flight: bool,
    pub attempts: u8,
    #[serde(skip)]
    generation: u32,
    #[serde(skip)]
    pending: bool,
    #[serde(skip)]
    watching: bool,
    #[serde(skip)]
    healthy_since: Option<f64>,
}

impl Recovery {
    pub fn apply(&mut self, event: Event) -> Vec<Effect> {
        let mut effects = Vec::new();
        match event {
            Event::Begin(position) => {
                self.clear(&mut effects);
                self.generation = self.generation.wrapping_add(1);
                self.intent = true;
                self.in_flight = false;
                self.attempts = 0;
                self.position = position.max(0.0);
                self.pending = false;
                self.buffer(&mut effects);
                self.transition(Phase::Loading, &mut effects);
            }
            Event::Resume(reset_attempts) => {
                self.intent = true;
                if reset_attempts {
                    self.attempts = 0;
                }
                self.buffer(&mut effects);
            }
            Event::Buffering => self.buffer(&mut effects),
            Event::Progress(position) => {
                if position.is_finite() && position >= 0.0 {
                    if self.intent && !self.watching && !self.in_flight && position > self.position
                    {
                        if position - *self.healthy_since.get_or_insert(position) >= 10.0 {
                            self.attempts = 0;
                        }
                    } else {
                        self.healthy_since = None;
                    }
                    self.position = position;
                }
            }
            Event::Playing => self.playing(&mut effects),
            Event::Pause => {
                self.clear(&mut effects);
                self.intent = false;
                self.pending = false;
                self.generation = self.generation.wrapping_add(1);
                self.in_flight = false;
                self.transition(Phase::Paused, &mut effects);
            }
            Event::Fail(online) => self.fail(online, &mut effects),
            Event::Reconnect => {
                if self.intent && self.pending {
                    self.pending = false;
                    self.fail(true, &mut effects);
                }
            }
            Event::RetryFinished(generation, ok, online) => {
                if generation == self.generation {
                    self.in_flight = false;
                    if ok {
                        self.playing(&mut effects);
                    } else if !online {
                        self.attempts = self.attempts.saturating_sub(1);
                        self.wait(&mut effects);
                    } else {
                        self.error(&mut effects);
                    }
                }
            }
        }
        effects
    }

    fn transition(&mut self, phase: Phase, effects: &mut Vec<Effect>) {
        if self.state != phase {
            self.state = phase;
            effects.push(Effect::StateChanged(phase));
        }
    }

    fn clear(&mut self, effects: &mut Vec<Effect>) {
        if self.watching {
            self.watching = false;
            effects.push(Effect::CancelWatchdog);
        }
    }

    fn buffer(&mut self, effects: &mut Vec<Effect>) {
        self.healthy_since = None;
        if self.intent && !self.watching && !self.in_flight {
            self.transition(Phase::Buffering, effects);
            self.watching = true;
            effects.push(Effect::StartWatchdog);
        }
    }

    fn playing(&mut self, effects: &mut Vec<Effect>) {
        self.clear(effects);
        self.pending = false;
        self.healthy_since = None;
        if self.intent {
            self.transition(Phase::Playing, effects);
        }
        effects.push(Effect::Recovered);
    }

    fn fail(&mut self, online: bool, effects: &mut Vec<Effect>) {
        if !self.intent || self.in_flight {
            return;
        }
        self.clear(effects);
        if !online {
            self.wait(effects);
        } else if self.attempts > 0 {
            self.error(effects);
        } else {
            self.attempts += 1;
            self.in_flight = true;
            self.transition(Phase::Recovering, effects);
            effects.push(Effect::Retry(self.generation, self.position));
        }
    }

    fn wait(&mut self, effects: &mut Vec<Effect>) {
        self.pending = true;
        self.transition(Phase::Offline, effects);
        effects.push(Effect::Waiting);
    }

    fn error(&mut self, effects: &mut Vec<Effect>) {
        self.intent = false;
        effects.push(Effect::Failed);
        self.transition(Phase::Error, effects);
    }
}
