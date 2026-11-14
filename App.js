import React, { useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Sharing from 'expo-sharing';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Video as Compressor, getFileSize } from 'react-native-compressor';
import { FFmpegKit, ReturnCode } from '@nikhil-cephei/ffmpeg-kit-react-native';

// maxSize = longest side in pixels. base = target video bitrate in bits per second.
const RESOLUTIONS = [
  { key: '4k', label: '4K', note: '3840 px', maxSize: 3840, base: 20_000_000 },
  { key: '1080', label: '1080p', note: '1920 px', maxSize: 1920, base: 8_000_000 },
  { key: '720', label: '720p', note: '1280 px', maxSize: 1280, base: 4_000_000 },
  { key: '480', label: '480p', note: '854 px', maxSize: 854, base: 1_600_000 },
];
const UPSCALES = [
  { key: '1440', label: '1440p', note: '2560 px', w: 2560 },
  { key: '4k', label: '4K UHD', note: '3840 px', w: 3840 },
];
const QUALITIES = [
  { key: 'max', label: 'Best', mult: 1.5 },
  { key: 'balanced', label: 'Balanced', mult: 1 },
  { key: 'small', label: 'Smallest', mult: 0.6 },
];
const TARGETS = [
  { key: '8', label: '8 MB', note: 'Chat', mb: 8 },
  { key: '16', label: '16 MB', note: 'Messaging', mb: 16 },
  { key: '25', label: '25 MB', note: 'Email', mb: 25 },
  { key: '100', label: '100 MB', note: 'Upload', mb: 100 },
];
const MODES = [
  { key: 'quality', label: 'Quality' },
  { key: 'size', label: 'File size' },
  { key: 'upscale', label: 'UHD upscale' },
];
const PRESETS = [
  { label: 'Archive', mode: 'quality', res: '4k', q: 'max' },
  { label: 'Everyday', mode: 'quality', res: '1080', q: 'balanced' },
  { label: 'Message', mode: 'size', res: '720', t: '16' },
  { label: 'Email', mode: 'size', res: '720', t: '25' },
  { label: 'UHD', mode: 'upscale', up: '4k' },
];

const MB = 1048576;
const mb = (b) => `${(b / MB).toFixed(b > 99 * MB ? 0 : 1)} MB`;
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const asFileUri = (p) => (p.startsWith('file://') ? p : `file://${p}`);

function Preview({ uri }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
  });
  return <VideoView player={player} style={s.video} contentFit="contain" nativeControls />;
}

function Segmented({ options, value, onChange, disabled }) {
  return (
    <View style={s.segment}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} disabled={disabled} onPress={() => onChange(o.key)} style={[s.segItem, on && s.segOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
            <Text style={[s.segLabel, on && s.segLabelOn]}>{o.label}</Text>
            {o.note ? <Text style={[s.segNote, on && s.segNoteOn]}>{o.note}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function Button({ title, onPress, kind = 'primary', disabled }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [s.btn, kind === 'ghost' ? s.btnGhost : s.btnPrimary, (pressed || disabled) && { opacity: 0.6 }]}>
      <Text style={[s.btnText, kind === 'ghost' && { color: C.neon }]}>{title}</Text>
    </Pressable>
  );
}

// Lanczos upscale + light sharpen/denoise, re-encoded with x264. This is classic upscaling, not AI.
function upscaleClip(it, w, onProgress) {
  return new Promise((resolve, reject) => {
    const inp = it.uri.replace('file://', '');
    const outp = `${inp.replace(/\.[^./]+$/, '')}-uhd.mp4`;
    const k = w / Math.max(it.width, it.height);
    const vf = `scale=trunc(iw*${k}/2)*2:trunc(ih*${k}/2)*2:flags=lanczos,unsharp=5:5:0.8:3:3:0.3,hqdn3d=1.5:1.5:4:4`;
    const cmd = `-y -i "${inp}" -vf "${vf}" -c:v libx264 -preset veryfast -crf 19 -pix_fmt yuv420p -c:a copy -movflags +faststart "${outp}"`;
    FFmpegKit.executeAsync(
      cmd,
      async (session) => {
        const rc = await session.getReturnCode();
        if (ReturnCode.isSuccess(rc)) resolve(outp);
        else reject(new Error('upscale failed'));
      },
      undefined,
      (st) => onProgress(Math.min(1, st.getTime() / Math.max(it.duration * 1000, 1)))
    );
  });
}
