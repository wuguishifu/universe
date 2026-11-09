use std::ops::Sub;
use std::time::Duration;

/// A point on the capture clock, in 100ns ticks (the unit of Windows' `REFERENCE_TIME`).
///
/// WASAPI and Windows.Graphics.Capture both report QPC-based times, so audio and video stamped
/// from them line up once converted to this unit.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Timestamp(pub i64);

impl Timestamp {
    pub const TICKS_PER_SECOND: i64 = 10_000_000;

    pub fn from_duration(duration: Duration) -> Self {
        Self(i64::try_from(duration.as_nanos() / 100).unwrap_or(i64::MAX))
    }

    /// The time from `earlier` to `self`, or zero when `earlier` is later.
    pub fn since(self, earlier: Timestamp) -> Duration {
        let ticks = u64::try_from(self.0.saturating_sub(earlier.0)).unwrap_or(0);
        Duration::from_nanos(ticks.saturating_mul(100))
    }
}

impl Sub<Duration> for Timestamp {
    type Output = Timestamp;

    fn sub(self, rhs: Duration) -> Timestamp {
        Timestamp(self.0.saturating_sub(Timestamp::from_duration(rhs).0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_durations_to_ticks() {
        assert_eq!(
            Timestamp::from_duration(Duration::from_secs(1)).0,
            Timestamp::TICKS_PER_SECOND
        );
        assert_eq!(
            Timestamp(25_000_000).since(Timestamp(5_000_000)),
            Duration::from_secs(2)
        );
        assert_eq!(Timestamp(0).since(Timestamp(10)), Duration::ZERO);
    }
}
