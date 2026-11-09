use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Duration;

use crate::Timestamp;

/// One encoded packet: a compressed video frame or a block of encoded audio.
#[derive(Clone, Debug)]
pub struct Packet {
    pub pts: Timestamp,
    /// Whether decoding can start here. Every audio packet is one.
    pub keyframe: bool,
    /// Shared, so taking a clip copies pointers rather than megabytes.
    pub data: Arc<[u8]>,
}

/// The last `window` of one encoded stream.
///
/// It holds encoded packets, never raw frames: two minutes of 1080p60 is a few hundred MB
/// encoded and hundreds of GB raw. Old packets are dropped a whole GOP at a time, so the oldest
/// packet held is always a keyframe and anything taken from the buffer can be decoded.
#[derive(Debug)]
pub struct ReplayBuffer {
    window: Duration,
    packets: VecDeque<Packet>,
    bytes: usize,
}

impl ReplayBuffer {
    pub fn new(window: Duration) -> Self {
        Self {
            window,
            packets: VecDeque::new(),
            bytes: 0,
        }
    }

    pub fn window(&self) -> Duration {
        self.window
    }

    /// Bytes of packet data held.
    pub fn bytes(&self) -> usize {
        self.bytes
    }

    pub fn len(&self) -> usize {
        self.packets.len()
    }

    pub fn is_empty(&self) -> bool {
        self.packets.is_empty()
    }

    /// How much time the buffer holds, from its oldest packet to its newest.
    pub fn span(&self) -> Duration {
        match (self.packets.front(), self.packets.back()) {
            (Some(first), Some(last)) => last.pts.since(first.pts),
            _ => Duration::ZERO,
        }
    }

    /// Adds a packet. Packets must come in presentation order; until the first keyframe they are
    /// dropped, as nothing before it can be decoded.
    pub fn push(&mut self, packet: Packet) {
        if self.packets.is_empty() && !packet.keyframe {
            return;
        }
        self.bytes += packet.data.len();
        self.packets.push_back(packet);
        self.evict();
    }

    /// Drops whole GOPs from the front while what is left still covers the window.
    fn evict(&mut self) {
        let Some(newest) = self.packets.back().map(|p| p.pts) else {
            return;
        };
        loop {
            // The start of the second GOP: dropping everything before it keeps a keyframe first.
            let Some(next) = self
                .packets
                .iter()
                .skip(1)
                .position(|p| p.keyframe)
                .map(|i| i + 1)
            else {
                return;
            };
            if newest.since(self.packets[next].pts) < self.window {
                return;
            }
            for packet in self.packets.drain(..next) {
                self.bytes -= packet.data.len();
            }
        }
    }

    /// The packets covering at least the last `duration`, starting at a keyframe: the latest one
    /// at or before `duration` ago, or the oldest packet when the buffer holds less than that.
    pub fn last(&self, duration: Duration) -> Vec<Packet> {
        let Some(newest) = self.packets.back().map(|p| p.pts) else {
            return Vec::new();
        };
        let from = newest - duration;
        let start = self
            .packets
            .iter()
            .rposition(|p| p.keyframe && p.pts <= from)
            .unwrap_or(0);
        self.packets.range(start..).cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECOND: i64 = Timestamp::TICKS_PER_SECOND;

    /// One packet per second, a keyframe every `gop` seconds, `size` bytes each.
    fn fill(buffer: &mut ReplayBuffer, seconds: i64, gop: i64, size: usize) {
        for s in 0..seconds {
            buffer.push(Packet {
                pts: Timestamp(s * SECOND),
                keyframe: s % gop == 0,
                data: vec![0; size].into(),
            });
        }
    }

    #[test]
    fn keeps_the_window_from_a_keyframe() {
        let mut buffer = ReplayBuffer::new(Duration::from_secs(10));
        fill(&mut buffer, 30, 4, 1);

        // Newest is 29s; the latest GOP starting at or before 19s starts at 16s.
        let first = buffer.packets.front().unwrap();
        assert!(first.keyframe);
        assert_eq!(first.pts, Timestamp(16 * SECOND));
        assert!(buffer.span() >= buffer.window());
        assert_eq!(buffer.bytes(), buffer.len());
    }

    #[test]
    fn drops_packets_before_the_first_keyframe() {
        let mut buffer = ReplayBuffer::new(Duration::from_secs(10));
        buffer.push(Packet {
            pts: Timestamp(0),
            keyframe: false,
            data: vec![0].into(),
        });
        assert!(buffer.is_empty());
    }

    #[test]
    fn takes_clips_from_a_keyframe() {
        let mut buffer = ReplayBuffer::new(Duration::from_secs(60));
        fill(&mut buffer, 30, 4, 1);

        // Newest is 29s, so 5s ago is 24s, a keyframe.
        let clip = buffer.last(Duration::from_secs(5));
        assert_eq!(clip.first().unwrap().pts, Timestamp(24 * SECOND));
        assert_eq!(clip.len(), 6);

        // 22s isn't a keyframe; the one before it is 20s.
        let clip = buffer.last(Duration::from_secs(7));
        assert_eq!(clip.first().unwrap().pts, Timestamp(20 * SECOND));

        // Asking for more than is held gives everything.
        assert_eq!(buffer.last(Duration::from_secs(600)).len(), 30);
    }
}
