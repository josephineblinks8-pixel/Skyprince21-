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
}export default function App() {
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [showing, setShowing] = useState('optimized');
  const [mode, setMode] = useState('quality');
  const [resKey, setResKey] = useState('1080');
  const [qualKey, setQualKey] = useState('balanced');
  const [targetKey, setTargetKey] = useState('16');
  const [upKey, setUpKey] = useState('4k');
  const [busy, setBusy] = useState(false);
  const cancelId = useRef(null);
  const cancelled = useRef(false);

  const res = RESOLUTIONS.find((r) => r.key === resKey);
  const qual = QUALITIES.find((q) => q.key === qualKey);
  const target = TARGETS.find((t) => t.key === targetKey);
  const up = UPSCALES.find((u) => u.key === upKey);

  const bitrateFor = (it) => {
    if (mode === 'quality') return Math.round(res.base * qual.mult);
    const total = (target.mb * MB * 8 * 0.92) / Math.max(it.duration, 1);
    return Math.min(Math.max(250_000, Math.round(total - 128_000)), res.base * 1.5);
  };
  const patch = (id, p) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...p } : i)));

  const sel = items.find((i) => i.id === selectedId) ?? items[0];
  const previewUri = sel ? (showing === 'optimized' && sel.out ? sel.out : sel.uri) : null;
  const pending = items.filter((i) => i.status !== 'done');
  const estimate = mode === 'upscale' ? 0 : pending.reduce((n, i) => n + (bitrateFor(i) * i.duration) / 8, 0);
  const done = items.filter((i) => i.out);
  const origTotal = done.reduce((n, i) => n + i.size, 0);
  const outTotal = done.reduce((n, i) => n + i.outSize, 0);
  const savedPct = origTotal ? Math.round((1 - outTotal / origTotal) * 100) : 0;
  const allUp = done.length > 0 && done.every((i) => i.up);

  const applyPreset = (p) => {
    setMode(p.mode);
    if (p.res) setResKey(p.res);
    if (p.q) setQualKey(p.q);
    if (p.t) setTargetKey(p.t);
    if (p.up) setUpKey(p.up);
  };

  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsMultipleSelection: true,
      selectionLimit: 10,
      videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
    });
    if (r.canceled) return;
    const added = await Promise.all(
      r.assets.map(async (a, i) => {
        let size = a.fileSize;
        if (!size) {
          try {
            size = Number(await getFileSize(a.uri));
          } catch {
            size = 0;
          }
        }
        return { id: `${Date.now()}-${i}`, uri: a.uri, width: a.width, height: a.height, duration: (a.duration ?? 0) / 1000, size, status: 'waiting', progress: 0 };
      })
    );
    setItems((prev) => [...prev, ...added]);
  };

  const run = async (all) => {
    cancelled.current = false;
    setBusy(true);
    const todo = all ? items : pending;
    for (const it of todo) {
      if (cancelled.current) break;
      if (mode === 'size' && it.size && it.size <= target.mb * MB) {
        patch(it.id, { status: 'skipped', out: undefined, outSize: undefined });
        continue;
      }
      if (mode === 'upscale' && Math.max(it.width, it.height) >= up.w) {
        patch(it.id, { status: 'skipped', out: undefined, outSize: undefined });
        continue;
      }
      patch(it.id, { status: 'working', progress: 0, out: undefined, outSize: undefined, up: false });
      try {
        let out;
        if (mode === 'upscale') {
          out = await upscaleClip(it, up.w, (p) => patch(it.id, { progress: p }));
        } else {
          out = await Compressor.compress(
            it.uri,
            { compressionMethod: 'manual', maxSize: res.maxSize, bitrate: bitrateFor(it), minimumFileSizeForCompress: 0, getCancellationId: (id) => (cancelId.current = id) },
            (p) => patch(it.id, { progress: p })
          );
        }
        patch(it.id, { status: 'done', up: mode === 'upscale', out: asFileUri(out), outSize: Number(await getFileSize(asFileUri(out))) });
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
  };return (
    <SafeAreaProvider>
      <SafeAreaView style={s.root}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <ScrollView contentContainerStyle={s.scroll}>
          <Text style={s.title}>Video optimizer</Text>
          <Text style={s.lead}>Shrink big clips up to 4K without losing the detail you care about.</Text>

          {!items.length ? (
            <Pressable onPress={pick} style={s.drop}>
              <Text style={s.dropTitle}>Choose videos</Text>
              <Text style={s.dropSub}>Pick up to 10 clips from your photo library</Text>
            </Pressable>
          ) : (
            <>
              <View style={s.frame}>
                <Preview key={previewUri} uri={previewUri} />
              </View>
              {sel?.out ? (
                <Segmented value={showing} onChange={setShowing} options={[{ key: 'original', label: 'Original' }, { key: 'optimized', label: 'Optimized' }]} />
              ) : null}

              <View style={s.listHead}>
                <Text style={s.section}>Queue ({items.length})</Text>
                <Pressable onPress={pick} disabled={busy}><Text style={s.link}>Add videos</Text></Pressable>
              </View>
              {items.map((it, n) => (
                <Pressable key={it.id} onPress={() => setSelectedId(it.id)} style={[s.row, it.id === sel?.id && s.rowOn]}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.rowTitle}>Clip {n + 1}</Text>
                    <Text style={s.meta}>{it.width}×{it.height}  {clock(it.duration)}  {it.size ? mb(it.size) : ''}</Text>
                    {it.status === 'working' ? (
                      <View style={[s.track, { marginTop: 6 }]}><View style={[s.fill, { width: `${Math.round(it.progress * 100)}%` }]} /></View>
                    ) : null}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text style={[s.status, it.status === 'done' && { color: C.pink }, it.status === 'failed' && { color: '#FF4D4D' }]}>{statusText(it)}</Text>
                    {!busy ? (
                      <Pressable onPress={() => setItems((p) => p.filter((x) => x.id !== it.id))} hitSlop={8}><Text style={s.link}>Remove</Text></Pressable>
                    ) : null}
                  </View>
                </Pressable>
              ))}

              <Text style={s.section}>Presets</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {PRESETS.map((p) => (
                  <Pressable key={p.label} disabled={busy} onPress={() => applyPreset(p)} style={s.chip}>
                    <Text style={s.chipText}>{p.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              <Segmented options={MODES} value={mode} onChange={setMode} disabled={busy} />
              {mode === 'upscale' ? (
                <>
                  <Text style={s.section}>Upscale to</Text>
                  <Segmented options={UPSCALES} value={upKey} onChange={setUpKey} disabled={busy} />
                </>
              ) : (
                <>
                  <Text style={s.section}>Resolution</Text>
                  <Segmented options={RESOLUTIONS} value={resKey} onChange={setResKey} disabled={busy} />
                </>
              )}
              {mode === 'quality' ? (
                <>
                  <Text style={s.section}>Quality</Text>
                  <Segmented options={QUALITIES} value={qualKey} onChange={setQualKey} disabled={busy} />
                </>
              ) : null}
              {mode === 'size' ? (
                <>
                  <Text style={s.section}>Keep each video under</Text>
                  <Segmented options={TARGETS} value={targetKey} onChange={setTargetKey} disabled={busy} />
                </>
              ) : null}
              <Text style={s.hint}>
                {mode === 'upscale'
                  ? 'Enlarges with sharpening and light noise cleanup. It makes clips bigger and crisper, but it cannot invent real detail like AI tools do. Expect several minutes per minute of video, and bigger files.'
                  : `${pending.length ? `About ${mb(estimate)} for ${pending.length} video${pending.length > 1 ? 's' : ''}. ` : ''}Clips smaller than the chosen resolution are not enlarged. Very short size targets on long clips can look soft.`}
              </Text>

              {busy ? (
                <Button title="Cancel" kind="ghost" onPress={cancel} />
              ) : pending.length ? (
                <Button title={`${mode === 'upscale' ? 'Upscale' : 'Optimize'} ${pending.length} video${pending.length > 1 ? 's' : ''}`} onPress={() => run(false)} />
              ) : (
                <Button title="Redo with these settings" onPress={() => run(true)} />
              )}

              {done.length && !busy ? (
                <View style={s.result}>
                  <Text style={s.big}>{allUp ? 'UHD ready' : savedPct > 0 ? `−${savedPct}%` : 'No savings'}</Text>
                  <Text style={s.hint}>
                    {mb(origTotal)} to {mb(outTotal)} across {done.length} video{done.length > 1 ? 's' : ''}.
                    {!allUp && savedPct <= 0 ? ' These clips are already compact, so keep the originals or pick a lower setting.' : ''}
                  </Text>
                  <View style={s.actions}>
                    <View style={{ flex: 1 }}><Button title="Save all" onPress={saveAll} /></View>
                    <View style={{ flex: 1 }}><Button title="Share clip" kind="ghost" onPress={share} /></View>
                  </View>
                </View>
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

  
