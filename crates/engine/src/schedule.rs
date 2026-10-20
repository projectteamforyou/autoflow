//! Schedule triggers: 5-field cron (device local time) or a fixed interval, with an optional
//! `startAt` / `endAt` window. Native shells poll [`Schedule::due`] about once per second.

use crate::schema::Trigger;
use chrono::{DateTime, Datelike, NaiveDateTime, Timelike, Utc};

/// A parsed 5-field cron expression (`minute hour day-of-month month day-of-week`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cron {
    minutes: Vec<bool>,
    hours: Vec<bool>,
    days: Vec<bool>,
    months: Vec<bool>,
    weekdays: Vec<bool>,
    dom_restricted: bool,
    dow_restricted: bool,
}

const MONTHS: [&str; 12] = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS: [&str; 7] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

fn parse_value(s: &str, names: &[&str], name_base: u32) -> Option<u32> {
    if let Ok(n) = s.parse::<u32>() {
        return Some(n);
    }
    let lower = s.to_ascii_lowercase();
    names.iter().position(|n| *n == lower).and_then(|i| u32::try_from(i).ok()).map(|i| i + name_base)
}

fn parse_field(field: &str, min: u32, max: u32, names: &[&str], name_base: u32) -> Result<(Vec<bool>, bool), String> {
    let mut set = vec![false; usize::try_from(max + 1).unwrap_or(0)];
    let restricted = field != "*" && field != "?";
    for part in field.split(',') {
        let (range, step) = match part.split_once('/') {
            Some((r, s)) => (r, s.parse::<u32>().map_err(|_| format!("invalid step \"{s}\""))?),
            None => (part, 1),
        };
        if step == 0 {
            return Err("step must be greater than 0".into());
        }
        let (lo, hi) = if range == "*" || range == "?" {
            (min, max)
        } else if let Some((a, b)) = range.split_once('-') {
            let a = parse_value(a, names, name_base).ok_or_else(|| format!("invalid value \"{a}\""))?;
            let b = parse_value(b, names, name_base).ok_or_else(|| format!("invalid value \"{b}\""))?;
            (a, b)
        } else {
            let v = parse_value(range, names, name_base).ok_or_else(|| format!("invalid value \"{range}\""))?;
            (v, if part.contains('/') { max } else { v })
        };
        if lo < min || hi > max || lo > hi {
            return Err(format!("value out of range {min}-{max} in \"{part}\""));
        }
        let mut v = lo;
        while v <= hi {
            if let Some(slot) = set.get_mut(usize::try_from(v).unwrap_or(usize::MAX)) {
                *slot = true;
            }
            v += step;
        }
    }
    Ok((set, restricted))
}

impl Cron {
    /// Parses `m h dom mon dow`. Supports `*`, lists, ranges, steps and month/day names;
    /// day-of-week accepts 0–7 (0 and 7 = Sunday).
    pub fn parse(expr: &str) -> Result<Self, String> {
        let fields: Vec<&str> = expr.split_whitespace().collect();
        if fields.len() != 5 {
            return Err("cron needs 5 fields: minute hour day-of-month month day-of-week".into());
        }
        let (minutes, _) = parse_field(fields[0], 0, 59, &[], 0)?;
        let (hours, _) = parse_field(fields[1], 0, 23, &[], 0)?;
        let (days, dom_restricted) = parse_field(fields[2], 1, 31, &[], 0)?;
        let (months, _) = parse_field(fields[3], 1, 12, &MONTHS, 1)?;
        let (mut weekdays, dow_restricted) = parse_field(fields[4], 0, 7, &DAYS, 0)?;
        if weekdays[7] {
            weekdays[0] = true;
        }
        Ok(Self { minutes, hours, days, months, weekdays, dom_restricted, dow_restricted })
    }

    /// True when the local wall-clock minute matches (Vixie semantics: when both day fields are
    /// restricted, either may match).
    pub fn matches(&self, t: &NaiveDateTime) -> bool {
        let idx = |v: u32| usize::try_from(v).unwrap_or(usize::MAX);
        let at = |set: &[bool], v: u32| set.get(idx(v)).copied().unwrap_or(false);
        if !at(&self.minutes, t.minute()) || !at(&self.hours, t.hour()) || !at(&self.months, t.month()) {
            return false;
        }
        let dom = at(&self.days, t.day());
        let dow = at(&self.weekdays, t.weekday().num_days_from_sunday());
        match (self.dom_restricted, self.dow_restricted) {
            (true, true) => dom || dow,
            (true, false) => dom,
            (false, true) => dow,
            (false, false) => true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Kind {
    Cron(Box<Cron>),
    Every { every_ms: u64, next_ms: u64 },
}

/// Runtime state of one schedule trigger.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Schedule {
    kind: Kind,
    start_ms: Option<i64>,
    end_ms: Option<i64>,
    last_minute: Option<i64>,
}

fn iso_ms(s: &str) -> Result<i64, String> {
    DateTime::parse_from_rfc3339(s).map(|d| d.with_timezone(&Utc).timestamp_millis()).map_err(|e| format!("invalid date \"{s}\": {e}"))
}

impl Schedule {
    /// Builds the schedule of a `schedule` trigger. `now_ms` anchors interval schedules.
    pub fn from_trigger(t: &Trigger, now_ms: u64) -> Result<Self, String> {
        let Trigger::Schedule { cron, every_ms, start_at, end_at } = t else {
            return Err("not a schedule trigger".into());
        };
        let start_ms = start_at.as_deref().map(iso_ms).transpose()?;
        let end_ms = end_at.as_deref().map(iso_ms).transpose()?;
        let kind = match (cron, every_ms) {
            (Some(c), _) if !c.trim().is_empty() => Kind::Cron(Box::new(Cron::parse(c)?)),
            (_, Some(e)) => {
                let anchor = start_ms.and_then(|s| u64::try_from(s).ok()).filter(|s| *s > now_ms).unwrap_or(now_ms + e);
                Kind::Every { every_ms: *e, next_ms: anchor }
            }
            _ => return Err("schedule needs cron or everyMs".into()),
        };
        Ok(Self { kind, start_ms, end_ms, last_minute: None })
    }

    /// True once per due occurrence. `now_ms` is epoch ms, `local` the device wall clock.
    pub fn due(&mut self, now_ms: u64, local: &NaiveDateTime) -> bool {
        let now_i = i64::try_from(now_ms).unwrap_or(i64::MAX);
        if self.start_ms.is_some_and(|s| now_i < s) || self.end_ms.is_some_and(|e| now_i > e) {
            return false;
        }
        match &mut self.kind {
            Kind::Cron(c) => {
                let minute = now_i.div_euclid(60_000);
                if self.last_minute == Some(minute) || !c.matches(local) {
                    return false;
                }
                self.last_minute = Some(minute);
                true
            }
            Kind::Every { every_ms, next_ms } => {
                if now_ms < *next_ms {
                    return false;
                }
                // Skip missed occurrences (sleep / hibernate) instead of firing a burst.
                let missed = (now_ms - *next_ms) / *every_ms;
                *next_ms += (missed + 1) * *every_ms;
                true
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn at(d: u32, h: u32, m: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(2026, 10, d).and_then(|x| x.and_hms_opt(h, m, 0)).expect("valid date")
    }

    #[test]
    fn cron_fields() {
        let c = Cron::parse("*/15 9-17 * * mon-fri").expect("valid");
        assert!(c.matches(&at(19, 9, 30))); // Monday
        assert!(!c.matches(&at(19, 9, 31)));
        assert!(!c.matches(&at(18, 9, 30))); // Sunday
        let both = Cron::parse("0 0 1 * 0").expect("valid");
        assert!(both.matches(&at(1, 0, 0)));
        assert!(both.matches(&at(18, 0, 0)));
        assert!(Cron::parse("61 * * * *").is_err());
        assert!(Cron::parse("* * *").is_err());
    }

    #[test]
    fn interval_fires_once_per_period() {
        let t = Trigger::Schedule { cron: None, every_ms: Some(60_000), start_at: None, end_at: None };
        let mut s = Schedule::from_trigger(&t, 0).expect("valid");
        let local = at(19, 0, 0);
        assert!(!s.due(30_000, &local));
        assert!(s.due(60_000, &local));
        assert!(!s.due(61_000, &local));
        assert!(s.due(400_000, &local));
        assert!(!s.due(410_000, &local));
    }

    #[test]
    fn cron_fires_once_per_minute() {
        let t = Trigger::Schedule { cron: Some("* * * * *".into()), every_ms: None, start_at: None, end_at: None };
        let mut s = Schedule::from_trigger(&t, 0).expect("valid");
        assert!(s.due(60_000, &at(19, 0, 1)));
        assert!(!s.due(60_500, &at(19, 0, 1)));
        assert!(s.due(120_000, &at(19, 0, 2)));
    }
}
