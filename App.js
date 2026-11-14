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

        setSelectedId((cur) => cur ?? it.id);
      } catch (e) {
        patch(it.id, { status: cancelled.current ? 'waiting' : 'failed' });
      }
    }
    setBusy(false);
  };

  const cancel = () => {
    cancelled.current = true;
    if (mode === 'upscale') FFmpegKit.cancel();
    else if (cancelId.current) Compressor.cancelCompression(cancelId.current);
  };

  const saveAll = async () => {
    try {
      const perm = await MediaLibrary.requestPermissionsAsync(true);
      if (!perm.granted) return Alert.alert('Allow photo access', 'Turn on photo access for this app in Settings to save videos.');
      for (const it of done) await MediaLibrary.saveToLibraryAsync(it.out);
      Alert.alert('Saved', `${done.length} optimized video${done.length > 1 ? 's are' : ' is'} in your photo library.`);
    } catch {
      // Play-compliant Android builds block media read permissions, so the share sheet saves the selected clip instead.
      share();
    }
  };

  const share = async () => {
    if (sel?.out && (await Sharing.isAvailableAsync())) Sharing.shareAsync(sel.out);
  };

  const statusText = (it) => {
    if (it.status === 'working') return `${Math.round(it.progress * 100)}%`;
    if (it.status === 'done') {
      if (it.up) return `Upscaled, ${mb(it.outSize)}`;
      return it.outSize >= it.size ? 'No savings' : `−${Math.round((1 - it.outSize / it.size) * 100)}% to ${mb(it.outSize)}`;
    }
    if (it.status === 'skipped') return mode === 'upscale' ? 'Already that size' : 'Already under target';
    if (it.status === 'failed') return 'Failed';
    return 'Ready';
  };

              ) : null}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

// Deep violet-black base, neon cyan for actions, hot pink for results.
const C = { bg: '#0A0714', card: '#141026', ink: '#F4F1FF', mute: '#9A93B8', line: '#2E2750', neon: '#00E5FF', pink: '#FF2E93' };

const glow = (color, radius = 12) => ({ shadowColor: color, shadowOpacity: 0.9, shadowRadius: radius, shadowOffset: { width: 0, height: 0 }, elevation: 8 });

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 20, gap: 14, paddingBottom: 48 },
  title: { fontSize: 34, fontWeight: '800', color: C.neon, letterSpacing: -0.8, textShadowColor: C.neon, textShadowRadius: 14, textShadowOffset: { width: 0, height: 0 } },
  lead: { fontSize: 16, lineHeight: 22, color: C.mute, marginBottom: 6 },
  drop: { height: 220, borderRadius: 20, borderWidth: 2, borderColor: C.neon, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.card, ...glow(C.neon, 14) },
  dropTitle: { fontSize: 22, fontWeight: '800', color: C.neon, textShadowColor: C.neon, textShadowRadius: 10, textShadowOffset: { width: 0, height: 0 } },
  dropSub: { fontSize: 14, color: C.mute },
  frame: { borderRadius: 16, overflow: 'hidden', backgroundColor: '#000', borderWidth: 1, borderColor: C.line },
  video: { width: '100%', aspectRatio: 16 / 9 },
  listHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row: { flexDirection: 'row', gap: 12, padding: 14, borderRadius: 14, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.line },
  rowOn: { borderColor: C.neon, ...glow(C.neon, 8) },
  rowTitle: { fontSize: 16, fontWeight: '700', color: C.ink },
  status: { fontSize: 13, fontWeight: '700', color: C.mute },
  meta: { fontSize: 13, color: C.mute, fontVariant: ['tabular-nums'] },
  link: { fontSize: 14, fontWeight: '700', color: C.neon },
  section: { fontSize: 15, fontWeight: '700', color: C.ink, marginTop: 6 },
  chip: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.neon },
  chipText: { fontSize: 14, fontWeight: '700', color: C.neon },
  segment: { flexDirection: 'row', backgroundColor: C.card, borderRadius: 14, padding: 4, borderWidth: 1, borderColor: C.line },
  segItem: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  segOn: { backgroundColor: C.neon, ...glow(C.neon, 8) },
  segLabel: { fontSize: 15, fontWeight: '700', color: C.ink },
  segLabelOn: { color: C.bg },
  segNote: { fontSize: 11, color: C.mute, marginTop: 2 },
  segNoteOn: { color: '#05414A' },
  hint: { fontSize: 13, lineHeight: 18, color: C.mute },
  btn: { height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: C.neon, ...glow(C.neon, 14) },
  btnGhost: { backgroundColor: C.card, borderWidth: 1.5, borderColor: C.neon },
  btnText: { fontSize: 16, fontWeight: '800', color: C.bg },
  track: { height: 6, borderRadius: 3, backgroundColor: C.line, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: C.neon },
  result: { backgroundColor: C.card, borderRadius: 18, padding: 18, gap: 8, borderWidth: 1, borderColor: C.pink, ...glow(C.pink, 12) },
  big: { fontSize: 44, fontWeight: '800', color: C.pink, letterSpacing: -1, textShadowColor: C.pink, textShadowRadius: 14, textShadowOffset: { width: 0, height: 0 } },
  actions: { flexDirection: 'row', gap: 10, marginTop: 6 },
});
