/** These are tags that were empirically determined using the `ffprobe` command on some sample video files */
export type StreamTags = Partial<{
  language: string;
  handler_name: string;
  timecode: string;
  vendor_id: string;
  encoder: string;
}>;

export type StreamBase = {
  index: number;
  codec_name: string;
  codec_long_name: string;
  profile: string;
  codec_tag_string: string;
  codec_tag: string;
  start_pts: number;
  start_time: string;
  duration_ts: number;
  duration: string;
  bit_rate: string;
  nb_frames: string;
  r_frame_rate: string;
  avg_frame_rate: string;
  time_base: string;
  id: string;
  extradata_size: number;
  disposition: Record<string, number>;
  tags: Record<string, string>;
};

export type VideoStream = StreamBase & {
  codec_type: 'video';
  width: number;
  height: number;
  coded_width: number;
  coded_height: number;
  closed_captions: number;
  film_grain: number;
  has_b_frames: number;
  sample_aspect_ratio: string;
  display_aspect_ratio: string;
  pix_fmt: string;
  level: number;
  color_range: string;
  color_space: string;
  color_transfer: string;
  color_primaries: string;
  chroma_location: string;
  refs: number;
  view_ids_available: string;
  view_pos_available: string;
};

export type AudioStream = StreamBase & {
  codec_type: 'audio';
  sample_fmt: string;
  sample_rate: string;
  channels: number;
  channel_layout: string;
  bits_per_sample: number;
  initial_padding: number;
};

export type Stream = VideoStream | AudioStream;
