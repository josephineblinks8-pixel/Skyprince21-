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
