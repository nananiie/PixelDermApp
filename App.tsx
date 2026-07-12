import React, { useState, useEffect, useRef } from 'react';
import {
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  Image,
  Alert,
  Modal,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
  Share,
} from 'react-native';
import { Camera, useCameraDevice, useCameraPermission, usePhotoOutput } from 'react-native-vision-camera';
import * as ImagePicker from 'react-native-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createNewUser, analyzeImage, updateUserName, BASE_URL,
  checkConnectivity, savePendingScan, loadPendingScan, clearPendingScan,
  type AnalyzeResult, type PendingScan,
} from './src/api';

// --- TYPES ---
type Profile = {
  id: string;
  name: string;
  age: string;
  sex: string;
  skinType: string;
  pin: string;
  sunExposure: string;
  sunscreenUse: string;
  outdoorFrequency: string;
  lastSunburn: string;
  userId: string | null;
  monitoredParts: string[];
  activePart: string;
  lastAnalysis: AnalyzeResult | null;
  scanHistory: Record<string, AnalyzeResult[]>;
};

const STORAGE_KEYS = {
  profiles: '@pixelderm_profiles',
  activeProfileId: '@pixelderm_active_profile_id',
  termsAccepted: '@pixelderm_terms_accepted',
};

const TC_TEXT = `Terms & Conditions and Privacy Policy

Last Updated: July 2026

By using PixelDerm, you agree to the following terms.

1. DATA COLLECTION
PixelDerm collects: skin images you capture, analysis results (spot count, texture, pigmentation), profile information (name, age, sex, skin type), and lifestyle data (sun exposure, sunscreen use, outdoor frequency).

2. HOW WE USE YOUR DATA
Your data is used to:
• Generate personalized skin health analysis and longitudinal trend monitoring
• Provide AI-powered recommendations tailored to your individual skin profile
• Compare current scans against your baseline for progress tracking

3. DATA STORAGE & SECURITY
Images and analysis data are stored on secured servers. Your profile information is also stored locally on your device.

4. DATA SHARING
We do not sell or share your personal data with third parties. Data is used solely to deliver and improve the PixelDerm service.

5. MEDICAL DISCLAIMER
PixelDerm is not a medical device and does not provide medical diagnoses or treatment advice. All recommendations are for informational and educational purposes only. Always consult a qualified dermatologist for medical evaluation and treatment.

6. DATA RETENTION
Your data is retained for as long as you use the app. You may delete all data at any time from the Settings screen.

7. YOUR CONSENT
By checking the box and tapping "Get Started", you explicitly consent to the collection and use of your data as described above for the purpose of providing personalized skin health recommendations.`;

// --- RESPONSIVE ---
// Content is always phone-width (phoneFrame centers it on tablets), so no scaling needed.
const sp = (n: number) => n;

// --- THEME ---
const COLORS = {
  primary: '#91AFC2',
  secondary: '#D1E0E8',
  bg: '#F8FBFC',
  card: '#FFFFFF',
  text: '#333333',
  subtext: '#7D8F99',
  white: '#FFFFFF',
  accent: '#5A7D8F',
  border: '#E0EAEF',
  riskLow: '#4CAF50',
  riskModerate: '#FF9800',
  riskHigh: '#F44336',
};

// --- DROPDOWN ---
const DropdownField = ({ placeholder, value, options, onSelect }) => {
  const [visible, setVisible] = useState(false);
  return (
    <>
      <TouchableOpacity style={styles.inputField} onPress={() => setVisible(true)} activeOpacity={0.8}>
        <Text style={{ color: value ? COLORS.text : '#AAAAAA', fontSize: 15 }}>{value || placeholder}</Text>
        <Text style={{ color: COLORS.subtext, fontSize: 12 }}>▼</Text>
      </TouchableOpacity>
      <Modal visible={visible} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setVisible(false)}>
          <View style={styles.dropdownSheet}>
            <Text style={styles.dropdownTitle}>{placeholder}</Text>
            {options.map((opt) => (
              <TouchableOpacity
                key={opt}
                style={[styles.dropdownItem, value === opt && { backgroundColor: COLORS.secondary }]}
                onPress={() => { onSelect(opt); setVisible(false); }}
              >
                <Text style={[styles.dropdownItemText, value === opt && { color: COLORS.accent, fontWeight: '600' }]}>{opt}</Text>
                {value === opt && <Text style={{ color: COLORS.accent }}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
};

// --- BODY PART TAB ---
const BodyPartTab = ({ parts, activePart, onSelect, onAdd }) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    style={styles.bodyPartScroll}
    contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 10, gap: 8 }}
  >
    {parts.map((part) => (
      <TouchableOpacity
        key={part}
        style={[styles.bodyPartChip, activePart === part && styles.bodyPartChipActive]}
        onPress={() => onSelect(part)}
      >
        <Text style={[styles.bodyPartChipText, activePart === part && styles.bodyPartChipTextActive]}>{part}</Text>
      </TouchableOpacity>
    ))}
    <TouchableOpacity style={styles.addBodyPartChip} onPress={onAdd}>
      <Text style={styles.addBodyPartText}>+ Add Area</Text>
    </TouchableOpacity>
  </ScrollView>
);

const AVAILABLE_BODY_PARTS = [
  'Face', 'Neck', 'Left Arm', 'Right Arm', 'Left Hand', 'Right Hand',
  'Chest', 'Back', 'Abdomen', 'Left Leg', 'Right Leg', 'Left Foot', 'Right Foot',
];

const SUN_EXPOSURE_OPTIONS = ['Less than 30 minutes', 'Less than an hour', 'More than an hour'];
const SUNSCREEN_USE_OPTIONS = ['None', 'Once a day', 'Twice a day', 'More than 3 times a day'];
const OUTDOOR_FREQUENCY_OPTIONS = ['1 day a week', '2 days a week', '3 days a week', '4 days a week', '5 days a week', '6 days a week', 'Every day'];
const LAST_SUNBURN_OPTIONS = ['None', 'A week ago', 'More than months ago'];

const computeSkinScore = (features: { spotCount: number; textureScore: number; pigmentation: number }) =>
  Math.min(100, Math.round(
    (
      (100 - Math.min(features.textureScore * 100, 100))
      + (100 - Math.min(features.pigmentation * 100, 100))
      + (100 - Math.min(features.spotCount * 2, 100))
    ) / 3
  ));

const skinScoreRisk = (score: number) =>
  score >= 70
    ? { label: 'Low', color: COLORS.riskLow }
    : score >= 40
    ? { label: 'Moderate', color: COLORS.riskModerate }
    : { label: 'High', color: COLORS.riskHigh };

const PixelDermApp = () => {
  // --- RESPONSIVE ---
  const { width: winW } = useWindowDimensions();
  const isTablet = winW >= 600;

  // --- STATE ---
  const [currentScreen, setCurrentScreen] = useState('landing');
  const [analysisTab, setAnalysisTab] = useState('results');
  // Upload flow
  const [selectedImage, setSelectedImage] = useState(null);
  const [capturedImageUri, setCapturedImageUri] = useState<string | null>(null);
  const [showConsistencyModal, setShowConsistencyModal] = useState(false);
  const [progress, setProgress] = useState(0);
  const progressRef = useRef(0);
  const [uploadMode, setUploadMode] = useState(null);
  const [cameraPosition, setCameraPosition] = useState<'back' | 'front'>('back');

  // Profiles
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [showAddPartModal, setShowAddPartModal] = useState(false);

  // Profile form
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [formName, setFormName] = useState('');
  const [formAge, setFormAge] = useState('');
  const [formSex, setFormSex] = useState('');
  const [formSkinType, setFormSkinType] = useState('');
  const [formPin, setFormPin] = useState('');
  const [formSunExposure, setFormSunExposure] = useState('');
  const [formSunscreenUse, setFormSunscreenUse] = useState('');
  const [formOutdoorFrequency, setFormOutdoorFrequency] = useState('');
  const [formLastSunburn, setFormLastSunburn] = useState('');

  // PIN entry
  const [showPinModal, setShowPinModal] = useState(false);
  const [pendingProfileId, setPendingProfileId] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const pinInputRef = useRef<any>(null);
  const processingCancelTimerRef = useRef<any>(null);
  const [showProcessingCancel, setShowProcessingCancel] = useState(false);

  // T&C / Privacy consent
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);

  // Offline / Pending scan
  const [pendingScanData, setPendingScanData] = useState<PendingScan | null>(null);
  const [showPendingScanModal, setShowPendingScanModal] = useState(false);

  // Camera
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice(cameraPosition);
  const photoOutput = usePhotoOutput();

  // --- DERIVED ---
  const activeProfile = profiles.find(p => p.id === activeProfileId) ?? null;

  const updateActiveProfile = (updates: Partial<Profile>) => {
    setProfiles(prev => prev.map(p => p.id === activeProfileId ? { ...p, ...updates } : p));
  };

  // --- EFFECTS ---
  useEffect(() => {
    if (currentScreen === 'upload' && uploadMode === 'camera' && !hasPermission) {
      requestPermission().catch(console.error);
    }
  }, [currentScreen, uploadMode, hasPermission]);

  useEffect(() => {
    if (currentScreen !== 'upload') {
      setSelectedImage(null);
      setCapturedImageUri(null);
      setShowConsistencyModal(false);
      setUploadMode(null);
      setCameraPosition('back');
    }
  }, [currentScreen]);

  useEffect(() => {
    const restore = async () => {
      try {
        const [profilesStr, termsStr] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.profiles),
          AsyncStorage.getItem(STORAGE_KEYS.termsAccepted),
        ]);

        if (termsStr === 'true') setTermsAccepted(true);

        if (profilesStr) {
          const saved = JSON.parse(profilesStr) as Profile[];
          setProfiles(saved);
          if (saved.length > 0) {
            // Don't auto-activate — require PIN entry via profile list
            setCurrentScreen('profile');
          }
        }

        // Load pending offline scan into state — modal is shown after profile login
        const pending = await loadPendingScan();
        if (pending) {
          setPendingScanData(pending);
        }
      } catch (e) {
        console.error('Failed to restore session:', e);
      }
    };
    restore().catch(console.error);
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEYS.termsAccepted, String(termsAccepted)).catch(() => {});
  }, [termsAccepted]);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEYS.profiles, JSON.stringify(profiles)).catch(() => {});
  }, [profiles]);

  useEffect(() => {
    if (activeProfileId) {
      AsyncStorage.setItem(STORAGE_KEYS.activeProfileId, activeProfileId).catch(() => {});
    }
  }, [activeProfileId]);

  // --- HANDLERS ---

  // Core analysis runner — accepts optional bodyArea override (used when resuming offline scan).
  const handleAnalyzeWithData = async (imageUri: string, bodyAreaOverride?: string) => {
    // Check connectivity before showing the processing screen.
    const isOnline = await checkConnectivity();
    if (!isOnline) {
      const scan: PendingScan = {
        imageUri,
        userId: activeProfile?.userId ?? null,
        profileId: activeProfileId ?? '',
        profileName: activeProfile?.name ?? '',
        bodyArea: bodyAreaOverride ?? activeProfile?.activePart ?? 'Face',
        sunProfile: {
          sunExposure: activeProfile?.sunExposure,
          sunscreenUse: activeProfile?.sunscreenUse,
          outdoorFrequency: activeProfile?.outdoorFrequency,
          lastSunburn: activeProfile?.lastSunburn,
        },
        savedAt: new Date().toISOString(),
      };
      await savePendingScan(scan);
      setPendingScanData(scan);
      Alert.alert(
        'No Internet Detected',
        "Your scan has been saved and will be analyzed automatically when you're back online.",
      );
      return;
    }

    progressRef.current = 0;
    setProgress(0);
    setShowProcessingCancel(false);
    setCurrentScreen('processing');

    const timer = setInterval(() => {
      const next = progressRef.current + (90 - progressRef.current) * 0.08;
      progressRef.current = next;
      setProgress(Math.round(next));
    }, 120);

    // Show a cancel button after 8 s in case the server is unreachable
    processingCancelTimerRef.current = setTimeout(() => setShowProcessingCancel(true), 8000);

    let hasError = false;
    try {
      let uid = activeProfile?.userId ?? null;
      if (!uid) {
        uid = await createNewUser(activeProfile?.name, activeProfile?.pin);
        updateActiveProfile({ userId: uid });
      }
      const bodyArea = bodyAreaOverride ?? activeProfile?.activePart ?? 'Face';
      const result = await analyzeImage(imageUri, uid, bodyArea, {
        sunExposure: activeProfile?.sunExposure,
        sunscreenUse: activeProfile?.sunscreenUse,
        outdoorFrequency: activeProfile?.outdoorFrequency,
        lastSunburn: activeProfile?.lastSunburn,
      });
      const prevHistory = activeProfile?.scanHistory ?? {};
      updateActiveProfile({
        lastAnalysis: result,
        scanHistory: { ...prevHistory, [bodyArea]: [result, ...(prevHistory[bodyArea] ?? [])] },
      });
    } catch (e: any) {
      hasError = true;
      Alert.alert('Analysis Error', e.message ?? 'Could not connect to the server. Please check your internet connection and try again.');
    } finally {
      clearInterval(timer);
      clearTimeout(processingCancelTimerRef.current);
      setShowProcessingCancel(false);
      if (hasError) {
        setCurrentScreen('upload');
      } else {
        progressRef.current = 100;
        setProgress(100);
        setTimeout(() => setCurrentScreen('analysis'), 400);
      }
    }
  };

  const handleAnalyze = (imageUri: string) => handleAnalyzeWithData(imageUri);

  // Resume a scan that was saved while offline.
  const handleResumePendingScan = async () => {
    setShowPendingScanModal(false);
    if (!pendingScanData) return;
    const scan = pendingScanData;
    await clearPendingScan();
    setPendingScanData(null);

    // Verify the image file still exists before attempting analysis
    try {
      const response = await fetch(scan.imageUri);
      if (!response.ok && response.status !== 0) throw new Error('gone');
    } catch {
      Alert.alert(
        'Image No Longer Available',
        'The saved photo was removed from temporary storage when the app was closed. Please take a new photo.',
        [{ text: 'Take New Photo', onPress: () => setCurrentScreen('upload') }]
      );
      return;
    }

    await handleAnalyzeWithData(scan.imageUri, scan.bodyArea);
  };

  const handleDiscardPendingScan = async () => {
    setShowPendingScanModal(false);
    await clearPendingScan();
    setPendingScanData(null);
    setCurrentScreen('upload');
  };

  // Share / print the current analysis result.
  const handleShareAnalysis = async () => {
    const analysisResult = activeProfile?.lastAnalysis;
    if (!analysisResult) return;
    const { features, baseline, recommendation, analysis, geminiRecommendation, uvDamage } = analysisResult;
    const skinScore = computeSkinScore(features);
    const riskInfo = skinScoreRisk(skinScore);
    const activePart = activeProfile?.activePart ?? 'Face';
    const scanDate = new Date(analysis.timestamp).toLocaleString();
    const spotDelta = baseline ? features.spotCount - baseline.spotCount : null;
    const line = '─'.repeat(34);

    const report = [
      'PIXELDERM SKIN ANALYSIS REPORT',
      line,
      '',
      `Patient      : ${activeProfile?.name ?? '—'}`,
      `Age / Sex    : ${activeProfile?.age ?? '—'} / ${activeProfile?.sex ?? '—'}`,
      `Skin Type    : ${activeProfile?.skinType ?? '—'}`,
      `Area Analyzed: ${activePart}`,
      `Date         : ${scanDate}`,
      '',
      'MEASURED METRICS',
      line,
      `Skin Score      : ${skinScore}%`,
      `Risk Level      : ${riskInfo.label}`,
      `Spots Detected  : ${features.spotCount}`,
      `Texture Score   : ${Math.min(features.textureScore * 100, 100).toFixed(1)}%`,
      `Pigmentation    : ${(features.pigmentation * 100).toFixed(1)}%`,
      '',
      ...(baseline ? [
        'BASELINE COMPARISON',
        line,
        `Spots     : ${features.spotCount} (baseline ${baseline.spotCount}, change ${spotDelta! >= 0 ? '+' : ''}${spotDelta})`,
        `Texture   : ${Math.min(features.textureScore * 100, 100).toFixed(1)}% (baseline ${Math.min(baseline.textureScore * 100, 100).toFixed(1)}%)`,
        `Pigment   : ${(features.pigmentation * 100).toFixed(1)}% (baseline ${(baseline.pigmentation * 100).toFixed(1)}%)`,
        `Status    : ${recommendation.status}`,
        '',
      ] : []),
      ...(uvDamage ? [
        'UV DAMAGE ASSESSMENT',
        line,
        `Level  : ${uvDamage.level}`,
        uvDamage.advice,
        '',
      ] : []),
      'RECOMMENDATION',
      line,
      recommendation.advice,
      '',
      ...(geminiRecommendation ? [
        'AI RECOMMENDATION',
        line,
        geminiRecommendation,
        '',
      ] : []),
      line,
      'Generated by PixelDerm',
      'For informational purposes only — not medical advice.',
      'Consult a qualified dermatologist for diagnosis and treatment.',
    ].join('\n');

    try {
      await Share.share({ title: 'PixelDerm Analysis Report', message: report });
    } catch (e: any) {
      if (e.message !== 'The user did not share') {
        Alert.alert('Share Error', e.message);
      }
    }
  };

  const handleTakePhoto = async () => {
    try {
      const photo = await photoOutput.capturePhoto({ enableShutterSound: false }, {});
      const rawPath = await photo.saveToTemporaryFileAsync();
      const uri = rawPath.startsWith('file://') ? rawPath : `file://${rawPath}`;
      photo.dispose();
      setCapturedImageUri(uri);
      setShowConsistencyModal(true);
    } catch (e: any) {
      Alert.alert('Camera Error', e.message ?? 'Failed to take photo');
    }
  };

  const handleCapture = async () => {
    const imageUri = (selectedImage as any)?.uri;
    if (!imageUri) {
      Alert.alert('No Image', 'Please select or capture an image first.');
      return;
    }
    const confirmed = await new Promise<boolean>(resolve =>
      Alert.alert(
        'Before You Scan',
        'Consistency in uploading images is encouraged to ensure accurate results.\n\nTry to scan the same area under similar lighting and distance each time.',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Continue', onPress: () => resolve(true) },
        ]
      )
    );
    if (!confirmed) return;
    await handleAnalyze(imageUri);
  };

  const handlePickFromGallery = () => {
    ImagePicker.launchImageLibrary({ mediaType: 'photo', maxWidth: 1000, maxHeight: 1000, quality: 0.8 }, (response) => {
      if (response.didCancel) return;
      if (response.errorCode) { Alert.alert('Error', 'Failed to pick image: ' + response.errorMessage); return; }
      if (response.assets?.length > 0) {
        const asset = response.assets[0];
        if ((asset.fileSize || 0) / (1024 * 1024) > 5) { Alert.alert('Error', 'Image size exceeds 5MB limit'); return; }
        setSelectedImage({ uri: asset.uri, fileName: asset.fileName });
        setUploadMode('gallery');
      }
    });
  };

  const handleAddBodyPart = (part: string) => {
    const current = activeProfile?.monitoredParts ?? ['Face'];
    if (!current.includes(part)) {
      updateActiveProfile({ monitoredParts: [...current, part], activePart: part });
    } else {
      updateActiveProfile({ activePart: part });
    }
    setShowAddPartModal(false);
  };

  const handleAddProfile = () => {
    setEditingProfile(null);
    setFormName(''); setFormAge(''); setFormSex(''); setFormSkinType(''); setFormPin('');
    setFormSunExposure(''); setFormSunscreenUse(''); setFormOutdoorFrequency(''); setFormLastSunburn('');
    setShowProfileModal(true);
  };

  const handleEditProfile = (profile: Profile) => {
    setEditingProfile(profile);
    setFormName(profile.name); setFormAge(profile.age);
    setFormSex(profile.sex); setFormSkinType(profile.skinType);
    setFormPin(profile.pin ?? '');
    setFormSunExposure(profile.sunExposure ?? '');
    setFormSunscreenUse(profile.sunscreenUse ?? '');
    setFormOutdoorFrequency(profile.outdoorFrequency ?? '');
    setFormLastSunburn(profile.lastSunburn ?? '');
    setShowProfileModal(true);
  };

  const handleDeleteProfile = (profileId: string) => {
    Alert.alert('Delete Profile', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => {
          setProfiles(prev => {
            const updated = prev.filter(p => p.id !== profileId);
            if (activeProfileId === profileId) {
              if (updated.length > 0) { setActiveProfileId(updated[0].id); }
              else { setActiveProfileId(null); setCurrentScreen('landing'); }
            }
            return updated;
          });
        },
      },
    ]);
  };

  const handleProfileMenu = (profile: Profile) => {
    const isActive = profile.id === activeProfileId;
    Alert.alert(profile.name, undefined, [
      ...(!isActive ? [{ text: 'Switch to this profile', onPress: () => requestProfileSwitch(profile.id) }] : []),
      { text: 'Edit', onPress: () => handleEditProfile(profile) },
      { text: 'Delete', style: 'destructive' as const, onPress: () => handleDeleteProfile(profile.id) },
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const requestProfileSwitch = (profileId: string) => {
    if (profileId === activeProfileId) { setCurrentScreen('home'); return; }
    setPendingProfileId(profileId);
    setPinInput('');
    setPinError('');
    setShowPinModal(true);
  };

  const handlePinConfirm = (entered: string) => {
    const target = profiles.find(p => p.id === pendingProfileId);
    if (!target) return;
    if (entered !== target.pin) {
      setPinError('Incorrect PIN. Please try again.');
      setPinInput('');
      return;
    }
    setActiveProfileId(pendingProfileId!);
    setCurrentScreen('home');
    setShowPinModal(false);
    setPendingProfileId(null);
    setPinInput('');
    setPinError('');

    // If there's a pending offline scan for this profile, offer to resume it
    if (pendingScanData && pendingScanData.profileId === pendingProfileId) {
      checkConnectivity().then(isOnline => {
        if (isOnline) setTimeout(() => setShowPendingScanModal(true), 600);
      });
    }
  };

  const handleSaveProfile = () => {
    const trimmedName = formName.trim();

    if (!trimmedName) {
      Alert.alert('Error', 'Please enter a name.'); return;
    }
    if (!/^[a-zA-Z\s]+$/.test(trimmedName)) {
      Alert.alert('Error', 'Name must contain letters only. Numbers and special characters are not allowed.'); return;
    }
    if (trimmedName.trim().length < 2) {
      Alert.alert('Error', 'Name must be at least 2 characters.'); return;
    }
    if (!/^\d{4}$/.test(formPin)) {
      Alert.alert('Error', 'PIN must be exactly 4 digits (numbers only).'); return;
    }

    const otherProfiles = editingProfile
      ? profiles.filter(p => p.id !== editingProfile.id)
      : profiles;

    if (otherProfiles.some(p => p.name.trim().toLowerCase() === trimmedName.toLowerCase())) {
      Alert.alert('Error', 'A profile with this name already exists. Please choose a different name.'); return;
    }
    if (otherProfiles.some(p => p.pin === formPin)) {
      Alert.alert('Error', 'This PIN is already used by another profile. Please choose a different PIN.'); return;
    }

    if (editingProfile) {
      setProfiles(prev => prev.map(p =>
        p.id === editingProfile.id
          ? { ...p, name: trimmedName, age: formAge, sex: formSex, skinType: formSkinType,
              pin: formPin, sunExposure: formSunExposure, sunscreenUse: formSunscreenUse,
              outdoorFrequency: formOutdoorFrequency, lastSunburn: formLastSunburn }
          : p
      ));
      if (editingProfile.userId) {
        updateUserName(editingProfile.userId, trimmedName, formPin).catch(() => {});
      }
    } else {
      const isFirst = profiles.length === 0;
      const newProfile: Profile = {
        id: `profile-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: trimmedName, age: formAge, sex: formSex, skinType: formSkinType,
        pin: formPin, sunExposure: formSunExposure, sunscreenUse: formSunscreenUse,
        outdoorFrequency: formOutdoorFrequency, lastSunburn: formLastSunburn,
        userId: null, monitoredParts: ['Face'], activePart: 'Face', lastAnalysis: null, scanHistory: {},
      };
      setProfiles(prev => [...prev, newProfile]);
      if (isFirst) { setActiveProfileId(newProfile.id); setCurrentScreen('home'); }
    }
    setShowProfileModal(false);
  };

  // --- TAB BAR ---
  const TabBar = () => (
    <View style={styles.tabBar}>
      {[
        { screen: 'home', label: 'Home', iconDefault: require('./assets/icons/home_logo.png'), iconActive: require('./assets/icons/homeShaded_logo.png') },
        { screen: 'upload', label: 'Upload Skin', iconDefault: require('./assets/icons/uploadSkin_logo.png'), iconActive: require('./assets/icons/uploadSkinShaded_logo.png') },
        { screen: 'profile', label: 'Profile', iconDefault: require('./assets/icons/user_logo.png'), iconActive: require('./assets/icons/userShaded_logo.png') },
        { screen: 'settings', label: 'Settings', iconDefault: require('./assets/icons/setting_logo.png'), iconActive: require('./assets/icons/settingShaded_logo.png') },
      ].map(({ screen, label, iconDefault, iconActive }) => {
        const active = currentScreen === screen || (screen === 'home' && currentScreen === 'history');
        return (
          <TouchableOpacity key={screen} onPress={() => setCurrentScreen(screen)} style={styles.tabItem}>
            <Image source={active ? iconActive : iconDefault} style={styles.tabIcon} />
            <Text style={[styles.tabText, active && { color: COLORS.accent }]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  // --- SCREENS ---
  const renderLanding = () => (
    <View style={[styles.fullScreen, { backgroundColor: COLORS.white }]}>
      <View style={styles.logoArea}>
        <Image source={require('./assets/icons/pixelDerm_logo.png')} style={styles.appLogo} resizeMode="contain" />
      </View>
      <View style={styles.bottomHero}>
        <Text style={styles.welcomeTitle}>Welcome to PixelDerm!</Text>

        {/* T&C consent checkbox */}
        <TouchableOpacity
          style={styles.checkboxRow}
          onPress={() => setTermsAccepted(v => !v)}
          activeOpacity={0.7}
        >
          <View style={[styles.checkbox, termsAccepted && styles.checkboxChecked]}>
            {termsAccepted && <Text style={{ color: COLORS.white, fontSize: 12, fontWeight: '700', lineHeight: 16 }}>✓</Text>}
          </View>
          <Text style={styles.checkboxLabel}>
            {'I agree to the '}
            <Text
              style={styles.linkText}
              onPress={() => setShowTermsModal(true)}
            >
              Terms and Conditions
            </Text>
            {' and consent to data collection for personalized recommendations.'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btnFull, !termsAccepted && styles.btnDisabled]}
          onPress={() => { if (termsAccepted) handleAddProfile(); }}
          activeOpacity={termsAccepted ? 0.8 : 1}
        >
          <Text style={styles.btnText}>Get Started</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderHome = () => {
    const monitoredParts = activeProfile?.monitoredParts ?? ['Face'];
    const activePart = activeProfile?.activePart ?? 'Face';
    const partHistory = (activeProfile?.scanHistory ?? {})[activePart] ?? [];
    const lastAnalysis = partHistory.length > 0 ? partHistory[0] : null;
    const uvScore = lastAnalysis ? computeSkinScore(lastAnalysis.features) : 0;
    return (
      <View style={styles.fullScreen}>
        <View style={styles.innerCanvas}>
          <View style={{ paddingHorizontal: 20, paddingTop: 20 }}>
            <Text style={styles.dashboardTitle}>{activeProfile ? `Hi, ${activeProfile.name}` : 'Homepage'}</Text>
            <Text style={styles.sectionHeader}>Monitoring Areas</Text>
          </View>
          <BodyPartTab
            parts={monitoredParts}
            activePart={activePart}
            onSelect={(part) => updateActiveProfile({ activePart: part })}
            onAdd={() => setShowAddPartModal(true)}
          />
          <ScrollView style={[styles.scrollContainer, { marginTop: 0 }]} showsVerticalScrollIndicator={false}>
            {lastAnalysis ? (
              <>
                <View style={[styles.cardBlock, { marginTop: 4 }]}>
                  <Text style={[styles.cardTitle, { marginBottom: 2 }]}>{activePart}</Text>
                  <Text style={styles.textSmall}>Last scanned: {new Date(lastAnalysis.analysis.timestamp).toLocaleDateString()}</Text>
                  <Text style={[styles.textSmall, { color: COLORS.accent, marginTop: 4 }]}>
                    Next scan recommended: {new Date(new Date(lastAnalysis.analysis.timestamp).getTime() + 14 * 24 * 60 * 60 * 1000).toLocaleDateString()}
                  </Text>
                </View>
                <View style={styles.scoreCard}>
                  <View>
                    <Text style={styles.cardLabel}>Last Analysis</Text>
                    <Text style={styles.cardValue}>{new Date(lastAnalysis.analysis.timestamp).toLocaleString()}</Text>
                  </View>
                  <View style={styles.scoreCircle}>
                    <Text style={[styles.scoreNum, { color: COLORS.text }]}>{uvScore}%</Text>
                    <Text style={styles.scoreLabel}>Skin Score</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.sectionHeader}>Tips</Text>
                  {lastAnalysis.geminiRecommendation && (
                    <View style={{ backgroundColor: COLORS.accent, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginTop: 2 }}>
                      <Text style={{ color: COLORS.white, fontSize: 10, fontWeight: '700' }}>AI</Text>
                    </View>
                  )}
                </View>
                <View style={styles.cardBlock}>
                  {lastAnalysis.geminiRecommendation
                    ? lastAnalysis.geminiRecommendation.split(/\.\s+/).filter(Boolean).map((tip, i) => (
                        <View key={i} style={styles.tipRow}>
                          <Text style={styles.tipBullet}>•</Text>
                          <Text style={styles.tipText}>{tip}</Text>
                        </View>
                      ))
                    : lastAnalysis.recommendation.advice.split(/\.\s+/).filter(Boolean).map((tip, i) => (
                        <View key={i} style={styles.tipRow}>
                          <Text style={styles.tipBullet}>•</Text>
                          <Text style={styles.tipText}>{tip}</Text>
                        </View>
                      ))
                  }
                </View>
                <Text style={styles.disclaimerText}>Recommendations are validated by dermatologists.</Text>
                <TouchableOpacity style={styles.historyBtn} onPress={() => setCurrentScreen('history')}>
                  <Text style={styles.historyBtnText}>View History</Text>
                </TouchableOpacity>
              </>
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateTitle}>No scans yet</Text>
                <Text style={styles.emptyStateText}>Take your first photo to see your skin analysis, scores, and personalized tips here.</Text>
                <TouchableOpacity style={[styles.btnFull, { marginTop: 20 }]} onPress={() => setCurrentScreen('upload')}>
                  <Text style={styles.btnText}>Take First Scan</Text>
                </TouchableOpacity>
              </View>
            )}
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
        <TabBar />
        <Modal visible={showAddPartModal} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={[styles.dropdownSheet, { maxHeight: '75%' }]}>
              <Text style={styles.dropdownTitle}>Add a Body Area to Monitor</Text>
              <FlatList
                data={AVAILABLE_BODY_PARTS.filter(p => !monitoredParts.includes(p))}
                keyExtractor={(item) => item}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.dropdownItem} onPress={() => handleAddBodyPart(item)}>
                    <Text style={styles.dropdownItemText}>{item}</Text>
                    <Text style={{ color: COLORS.primary }}>+ Add</Text>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <Text style={[styles.textSmall, { textAlign: 'center', padding: 20, color: COLORS.subtext }]}>All areas are already being monitored.</Text>
                }
              />
              <TouchableOpacity style={[styles.btnFull, { marginTop: 10, marginBottom: 0 }]} onPress={() => setShowAddPartModal(false)}>
                <Text style={styles.btnText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    );
  };

  const renderProfile = () => (
    <View style={styles.fullScreen}>
      <View style={styles.innerCanvas}>
        <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
          <View style={styles.profileHeader}>
            <View>
              <Text style={styles.dashboardTitle}>Profile</Text>
              <Text style={styles.subtext}>Edit your information</Text>
            </View>
            <TouchableOpacity style={styles.addProfileBtn} onPress={handleAddProfile}>
              <Text style={styles.addProfileBtnText}>Add Profile</Text>
            </TouchableOpacity>
          </View>

          {profiles.map(profile => (
            <TouchableOpacity
              key={profile.id}
              style={[styles.profileCard, activeProfile?.id === profile.id && styles.profileCardActive]}
              onPress={() => requestProfileSwitch(profile.id)}
              activeOpacity={0.8}
            >
              <View style={styles.profileCardRow}>
                <View style={styles.profileIconCircle}>
                  <Text style={styles.profileIconText}>👤</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.profileName}>{profile.name}</Text>
                  <View style={styles.profileStats}>
                    <View style={styles.profileStat}>
                      <Text style={styles.profileStatLabel}>Sex</Text>
                      <Text style={styles.profileStatValue}>{profile.sex || '—'}</Text>
                    </View>
                    <View style={styles.profileStat}>
                      <Text style={styles.profileStatLabel}>Skin type</Text>
                      <Text style={styles.profileStatValue}>{profile.skinType || '—'}</Text>
                    </View>
                    <View style={styles.profileStat}>
                      <Text style={styles.profileStatLabel}>Age</Text>
                      <Text style={styles.profileStatValue}>{profile.age || '—'}</Text>
                    </View>
                  </View>
                  {(profile.sunExposure || profile.sunscreenUse || profile.outdoorFrequency || profile.lastSunburn) && (
                    <View style={[styles.profileStats, { marginTop: 8, flexWrap: 'wrap', gap: 8 }]}>
                      {profile.sunExposure ? (
                        <View style={styles.profileSunTag}>
                          <Text style={styles.profileSunTagText}>☀ {profile.sunExposure}</Text>
                        </View>
                      ) : null}
                      {profile.sunscreenUse ? (
                        <View style={styles.profileSunTag}>
                          <Text style={styles.profileSunTagText}>🧴 {profile.sunscreenUse}</Text>
                        </View>
                      ) : null}
                      {profile.outdoorFrequency ? (
                        <View style={styles.profileSunTag}>
                          <Text style={styles.profileSunTagText}>🚶 {profile.outdoorFrequency}</Text>
                        </View>
                      ) : null}
                      {profile.lastSunburn ? (
                        <View style={styles.profileSunTag}>
                          <Text style={styles.profileSunTagText}>🔴 Sunburn: {profile.lastSunburn}</Text>
                        </View>
                      ) : null}
                    </View>
                  )}
                </View>
                <TouchableOpacity
                  style={styles.profileMenuBtn}
                  onPress={() => handleProfileMenu(profile)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Text style={styles.profileMenuIcon}>⋮</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          ))}

          {profiles.length === 0 && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateTitle}>No profiles yet</Text>
              <Text style={styles.emptyStateText}>Add a profile to start tracking your skin health.</Text>
              <TouchableOpacity style={[styles.btnFull, { marginTop: 20 }]} onPress={handleAddProfile}>
                <Text style={styles.btnText}>Add Profile</Text>
              </TouchableOpacity>
            </View>
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
      {activeProfileId && <TabBar />}
    </View>
  );

  const renderUpload = () => (
    <View style={styles.fullScreen}>
      <View style={styles.innerCanvas}>
        <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
          <Text style={styles.dashboardTitle}>Skin Analysis</Text>
          <Text style={styles.subtext}>Take a photo or upload from gallery</Text>
          <View style={styles.outlinedCard}>
            <Text style={styles.cardTitle}>Image of Skin</Text>
            <View style={styles.uploadModeRow}>
              <TouchableOpacity style={[styles.modePill, uploadMode === 'camera' && styles.modePillActive]} onPress={() => { setSelectedImage(null); setUploadMode('camera'); }}>
                <Text style={[styles.modePillText, uploadMode === 'camera' && styles.modePillTextActive]}>Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modePill, uploadMode === 'gallery' && styles.modePillActive]} onPress={handlePickFromGallery}>
                <Text style={[styles.modePillText, uploadMode === 'gallery' && styles.modePillTextActive]}>Gallery</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.cameraPlaceholder}>
              {uploadMode === null && (
                <Text style={{ color: COLORS.subtext, textAlign: 'center', paddingHorizontal: 20 }}>Select Camera or Gallery above to get started</Text>
              )}
              {uploadMode === 'camera' && (
                <>
                  {!hasPermission ? (
                    <Text style={{ color: COLORS.subtext }}>Requesting camera permission…</Text>
                  ) : device == null ? (
                    <ActivityIndicator size="large" color={COLORS.primary} />
                  ) : capturedImageUri ? (
                    <Image source={{ uri: capturedImageUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  ) : (
                    <>
                      <Camera
                        style={StyleSheet.absoluteFill}
                        device={device}
                        isActive={currentScreen === 'upload' && uploadMode === 'camera'}
                        outputs={[photoOutput]}
                      />
                      <View style={styles.cameraControls}>
                        <TouchableOpacity style={styles.cameraControlBtn} onPress={() => setCameraPosition(p => p === 'back' ? 'front' : 'back')}>
                          <Text style={styles.cameraControlText}>🔄</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
                </>
              )}
              {uploadMode === 'gallery' && selectedImage && (
                <Image source={{ uri: selectedImage.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              )}
            </View>
            <Text style={styles.centerSubtext}>JPG or PNG (max. 5MB)</Text>
            {uploadMode === 'camera' && !capturedImageUri && (
              <TouchableOpacity style={styles.btnFull} onPress={handleTakePhoto}>
                <Text style={styles.btnText}>Take Photo</Text>
              </TouchableOpacity>
            )}
            {uploadMode === 'camera' && capturedImageUri && (
              <TouchableOpacity style={[styles.clearImageBtn, { marginTop: 10 }]} onPress={() => setCapturedImageUri(null)}>
                <Text style={styles.clearImageBtnText}>Retake Photo</Text>
              </TouchableOpacity>
            )}
            {uploadMode === 'gallery' && selectedImage && (
              <View style={{ gap: 8, marginTop: 10 }}>
                <TouchableOpacity style={styles.btnFull} onPress={handleCapture}>
                  <Text style={styles.btnText}>Analyze This Image</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.clearImageBtn} onPress={() => { setSelectedImage(null); setUploadMode(null); }}>
                  <Text style={styles.clearImageBtnText}>Clear Selection</Text>
                </TouchableOpacity>
              </View>
            )}
            {uploadMode === 'gallery' && !selectedImage && (
              <TouchableOpacity style={[styles.btnFull, { marginTop: 10 }]} onPress={handlePickFromGallery}>
                <Text style={styles.btnText}>Choose from Gallery</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.outlinedCard}>
            <Text style={styles.cardTitle}>Photo Tips</Text>
            <Text style={styles.bulletText}>• Use natural lighting if possible</Text>
            <Text style={styles.bulletText}>• Keep the camera steady</Text>
            <Text style={styles.bulletText}>• Ensure the area is clearly visible</Text>
            <Text style={styles.bulletText}>• Avoid shadows on the skin</Text>
            <Text style={[styles.cardTitle, { marginTop: 15 }]}>Note</Text>
            <Text style={styles.bulletText}>• Users with vitiligo <Text style={{ fontWeight: 'bold' }}>may</Text> receive inaccurate results</Text>
          </View>
          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
      <TabBar />
    </View>
  );

  const renderProcessing = () => (
    <View style={styles.fullScreen}>
      <View style={[styles.innerCanvas, { justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
        <View style={styles.processingCard}>
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginBottom: 20 }} />
          <Text style={styles.dashboardTitle}>Processing your image</Text>
          <Text style={styles.subtext}>Scanning for abnormalities...</Text>
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${progress}%` }]} />
          </View>
          <Text style={styles.centerSubtext}>{progress}%</Text>
          {showProcessingCancel && (
            <>
              <Text style={[styles.centerSubtext, { marginTop: 16, color: COLORS.riskModerate }]}>
                This is taking longer than expected...
              </Text>
              <TouchableOpacity
                style={[styles.clearImageBtn, { marginTop: 10, width: '100%' }]}
                onPress={() => {
                  clearTimeout(processingCancelTimerRef.current);
                  setShowProcessingCancel(false);
                  setCurrentScreen('upload');
                }}
              >
                <Text style={styles.clearImageBtnText}>Cancel</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
      <TabBar />
    </View>
  );

  const renderAnalysis = () => {
    const analysisResult = activeProfile?.lastAnalysis;
    if (!analysisResult) return null;
    const { features, baseline, recommendation, analysis, geminiRecommendation } = analysisResult;
    const skinScore = computeSkinScore(features);
    const riskInfo = skinScoreRisk(skinScore);
    const pigmentPct = (features.pigmentation * 100).toFixed(1);
    const textureFmt = Math.min(100, features.textureScore * 100).toFixed(1) + '%';
    const scanDate = new Date(analysis.timestamp).toLocaleString();
    const spotDelta = baseline ? features.spotCount - baseline.spotCount : null;
    const textureDeltaRaw = baseline ? (features.textureScore - baseline.textureScore) * 100 : null;
    const textureDelta = textureDeltaRaw !== null ? textureDeltaRaw.toFixed(1) : null;
    const pigmentDelta = baseline ? ((features.pigmentation - baseline.pigmentation) * 100).toFixed(1) : null;
    const fmt = (n: number | null, unit = '') => n === null ? '—' : `${n > 0 ? '+' : ''}${n}${unit}`;
    const activePart = activeProfile?.activePart ?? 'Face';
    const currentImageUrl = analysisResult.currentImageUrl ? `${BASE_URL}${analysisResult.currentImageUrl}` : null;
    const previousImageUrl = analysisResult.previousImageUrl ? `${BASE_URL}${analysisResult.previousImageUrl}` : null;

    return (
      <View style={styles.fullScreen}>
        <View style={styles.innerCanvas}>
          <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.dashboardTitle}>Analysis Complete</Text>
                <Text style={styles.subtext}>{scanDate}</Text>
              </View>
              <TouchableOpacity style={styles.printBtn} onPress={handleShareAnalysis}>
                <Text style={styles.printBtnText}>Share / Print</Text>
              </TouchableOpacity>
            </View>
            <View style={[styles.outlinedCard, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
              <View>
                <Text style={styles.cardLabel}>Risk Level</Text>
                <Text style={[styles.cardValue, { color: riskInfo.color }]}>{riskInfo.label}</Text>
              </View>
              <View style={{ alignItems: 'center' }}>
                <Text style={styles.cardLabel}>Skin Score</Text>
                <Text style={[styles.cardValue, { color: riskInfo.color }]}>{skinScore}%</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.cardLabel}>Area</Text>
                <Text style={styles.cardValue}>{activePart}</Text>
              </View>
            </View>
            <View style={styles.customTabBar}>
              {['results', 'comparison'].map((tab) => (
                <TouchableOpacity key={tab} style={[styles.customTab, analysisTab === tab && styles.customTabActive]} onPress={() => setAnalysisTab(tab)}>
                  <Text style={[styles.customTabText, analysisTab === tab && styles.customTabTextActive]}>{tab === 'results' ? 'Results' : 'vs Baseline'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {analysisTab === 'results' ? (
              <>
                <View style={styles.outlinedCard}>
                  <Text style={styles.cardTitle}>Detected Metrics</Text>
                  <View style={styles.resultRow}>
                    <Text style={styles.resultText}>Spots detected</Text>
                    <Text style={[styles.resultText, { fontWeight: 'bold', color: riskInfo.color }]}>{features.spotCount}</Text>
                  </View>
                  <View style={styles.resultRow}>
                    <Text style={styles.resultText}>Texture score</Text>
                    <Text style={[styles.resultText, { fontWeight: 'bold' }]}>{textureFmt}</Text>
                  </View>
                  <View style={[styles.resultRow, { borderBottomWidth: 0 }]}>
                    <Text style={styles.resultText}>Pigmentation</Text>
                    <Text style={[styles.resultText, { fontWeight: 'bold' }]}>{pigmentPct}%</Text>
                  </View>
                </View>
                <View style={[styles.outlinedCard, { backgroundColor: COLORS.secondary + '40' }]}>
                  <Text style={styles.cardTitle}>Recommendation</Text>
                  <View style={styles.recommendationBubble}>
                    <Text style={styles.textSmall}>{recommendation.advice}</Text>
                  </View>
                  {riskInfo.label === 'High' && (
                    <View style={styles.warningBox}>
                      <Text style={styles.warningText}>High spot density detected. Please consult a dermatologist for a professional evaluation.</Text>
                    </View>
                  )}
                </View>
                {geminiRecommendation && (
                  <View style={[styles.outlinedCard, { borderColor: COLORS.accent, borderWidth: 1.5 }]}>
                    <Text style={styles.cardTitle}>AI Recommendation</Text>
                    <Text style={[styles.textSmall, { lineHeight: 20 }]}>{geminiRecommendation}</Text>
                  </View>
                )}
                <Text style={styles.disclaimerText}>Recommendations are validated by dermatologists.</Text>
              </>
            ) : (
              <>
                {(currentImageUrl || previousImageUrl) && (
                  <View style={styles.outlinedCard}>
                    <Text style={styles.cardTitle}>Image Comparison</Text>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <View style={{ flex: 1, alignItems: 'center' }}>
                        <Text style={[styles.subtext, { marginBottom: 6, fontSize: 11 }]}>Previous</Text>
                        {previousImageUrl ? (
                          <Image
                            source={{ uri: previousImageUrl }}
                            style={{ width: '100%', aspectRatio: 1, borderRadius: 8, backgroundColor: COLORS.border }}
                            resizeMode="cover"
                          />
                        ) : (
                          <View style={{ width: '100%', aspectRatio: 1, borderRadius: 8, backgroundColor: COLORS.border, justifyContent: 'center', alignItems: 'center' }}>
                            <Text style={[styles.subtext, { fontSize: 11, textAlign: 'center' }]}>No previous{'\n'}scan</Text>
                          </View>
                        )}
                      </View>
                      <View style={{ flex: 1, alignItems: 'center' }}>
                        <Text style={[styles.subtext, { marginBottom: 6, fontSize: 11 }]}>Current</Text>
                        {currentImageUrl ? (
                          <Image
                            source={{ uri: currentImageUrl }}
                            style={{ width: '100%', aspectRatio: 1, borderRadius: 8, backgroundColor: COLORS.border }}
                            resizeMode="cover"
                          />
                        ) : (
                          <View style={{ width: '100%', aspectRatio: 1, borderRadius: 8, backgroundColor: COLORS.border, justifyContent: 'center', alignItems: 'center' }}>
                            <Text style={[styles.subtext, { fontSize: 11 }]}>Unavailable</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </View>
                )}
                {baseline ? (
                  <>
                    <View style={styles.outlinedCard}>
                      <Text style={styles.cardTitle}>Overall Change</Text>
                      <View style={styles.recommendationBubble}>
                        <Text style={[styles.textSmall, { fontWeight: '600', color: riskInfo.color }]}>
                          {recommendation.status === 'Stable' ? 'Stable' : recommendation.status === 'Regression Detected' ? 'Regression Detected' : 'Improving'}
                        </Text>
                        <Text style={[styles.textSmall, { marginTop: 4 }]}>{recommendation.status === 'Stable' ? 'Your skin metrics are stable compared to your baseline. Keep up your current routine.' : recommendation.advice}</Text>
                      </View>
                    </View>
                    <View style={styles.outlinedCard}>
                      <Text style={styles.cardTitle}>Current vs Baseline</Text>
                      <View style={styles.resultRow}>
                        <Text style={styles.resultText}>Spots</Text>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={styles.resultText}>{features.spotCount} <Text style={styles.subtext}>(baseline {baseline.spotCount})</Text></Text>
                          <Text style={{ color: spotDelta! > 0 ? COLORS.riskHigh : COLORS.riskLow, fontWeight: 'bold' }}>{fmt(spotDelta)}</Text>
                        </View>
                      </View>
                      <View style={styles.resultRow}>
                        <Text style={styles.resultText}>Texture</Text>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={styles.resultText}>{textureFmt} <Text style={styles.subtext}>(baseline {Math.min(100, baseline.textureScore * 100).toFixed(1)}%)</Text></Text>
                          <Text style={{ color: (textureDeltaRaw ?? 0) > 0 ? COLORS.riskHigh : COLORS.riskLow, fontWeight: 'bold' }}>{textureDelta !== null ? `${(textureDeltaRaw ?? 0) > 0 ? '+' : ''}${textureDelta}%` : '—'}</Text>
                        </View>
                      </View>
                      <View style={[styles.resultRow, { borderBottomWidth: 0 }]}>
                        <Text style={styles.resultText}>Pigmentation</Text>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={styles.resultText}>{pigmentPct}% <Text style={styles.subtext}>(baseline {(baseline.pigmentation * 100).toFixed(1)}%)</Text></Text>
                          <Text style={{ color: Number(pigmentDelta) > 0 ? COLORS.riskHigh : COLORS.riskLow, fontWeight: 'bold' }}>{pigmentDelta !== null ? `${Number(pigmentDelta) > 0 ? '+' : ''}${pigmentDelta}%` : '—'}</Text>
                        </View>
                      </View>
                    </View>
                  </>
                ) : (
                  <View style={styles.outlinedCard}>
                    <Text style={[styles.textSmall, { color: COLORS.subtext, textAlign: 'center', paddingVertical: 20 }]}>
                      This is your first scan for {activePart}.{'\n'}A baseline has been set — future scans will be compared against it.
                    </Text>
                  </View>
                )}
              </>
            )}
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
        <TabBar />
      </View>
    );
  };

  const renderHistory = () => {
    const activePart = activeProfile?.activePart ?? 'Face';
    const history = (activeProfile?.scanHistory ?? {})[activePart] ?? [];

    const handleDeleteScan = (index: number) => {
      Alert.alert('Delete Scan', 'Remove this scan from history?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: () => {
            const cur = activeProfile?.scanHistory ?? {};
            const updated = [...(cur[activePart] ?? [])];
            updated.splice(index, 1);
            updateActiveProfile({
              scanHistory: { ...cur, [activePart]: updated },
              lastAnalysis: updated.length > 0 ? updated[0] : null,
            });
          },
        },
      ]);
    };

    return (
      <View style={styles.fullScreen}>
        <View style={styles.innerCanvas}>
          <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 5 }}>
              <View>
                <Text style={styles.dashboardTitle}>History</Text>
                <Text style={styles.subtext}>View your past scans.</Text>
              </View>
              <View style={styles.areaTag}>
                <Text style={styles.areaTagText}>{activePart}</Text>
              </View>
            </View>
            {history.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateTitle}>No scans yet</Text>
                <Text style={styles.emptyStateText}>Scan your {activePart} to start building your history.</Text>
              </View>
            ) : (
              history.map((scan, index) => {
                const date = new Date(scan.analysis.timestamp).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
                const spotCount = scan.features.spotCount;
                const pigmentPct = Math.round(scan.features.pigmentation * 100);
                const textureVal = parseFloat(Math.min(100, scan.features.textureScore * 100).toFixed(2));
                const scanScore = computeSkinScore(scan.features);
                const scoreColor = skinScoreRisk(scanScore).color;
                return (
                  <View key={scan.analysis.analysisId ?? index} style={styles.historyCard}>
                    <View style={styles.historyCardHeader}>
                      <Text style={styles.historyCardDate}>{date}</Text>
                      <TouchableOpacity onPress={() => handleDeleteScan(index)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                        <Text style={styles.profileMenuIcon}>⋮</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={styles.historyCardMetrics}>
                      <View style={styles.historyMetric}>
                        <Text style={styles.historyMetricLabel}>Spot</Text>
                        <Text style={styles.historyMetricValue}>{spotCount}</Text>
                      </View>
                      <View style={styles.historyMetric}>
                        <Text style={styles.historyMetricLabel}>Hyperpigmentation</Text>
                        <Text style={styles.historyMetricValue}>{pigmentPct}%</Text>
                      </View>
                      <View style={styles.historyMetric}>
                        <Text style={styles.historyMetricLabel}>Texture</Text>
                        <Text style={styles.historyMetricValue}>{textureVal}%</Text>
                      </View>
                      <View style={styles.historyMetric}>
                        <Text style={styles.historyMetricLabel}>Skin Score</Text>
                        <Text style={[styles.historyMetricValue, { color: scoreColor }]}>{scanScore}%</Text>
                      </View>
                    </View>
                  </View>
                );
              })
            )}
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
        <TabBar />
      </View>
    );
  };

  const renderSettings = () => (
    <View style={styles.fullScreen}>
      <View style={styles.innerCanvas}>
        <ScrollView style={styles.scrollContainer}>
          <Text style={styles.dashboardTitle}>Settings</Text>
          <Text style={styles.subtext}>Manage your app preferences</Text>
          <View style={styles.outlinedCard}>
            <Text style={styles.cardTitle}>Data Management</Text>
            <TouchableOpacity
              style={styles.btnDanger}
              onPress={() => Alert.alert(
                'Clear All Data',
                'This will delete all profiles and scan history. This action cannot be undone.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Clear', style: 'destructive',
                    onPress: async () => {
                      await AsyncStorage.multiRemove([STORAGE_KEYS.profiles, STORAGE_KEYS.activeProfileId, '@pixelderm_user_id']).catch(() => {});
                      setProfiles([]);
                      setActiveProfileId(null);
                      setCurrentScreen('landing');
                    },
                  },
                ],
              )}
            >
              <Text style={styles.btnText}>Clear All Data</Text>
            </TouchableOpacity>
            <Text style={[styles.centerSubtext, { marginTop: 10, fontSize: 10 }]}>This will delete all profiles and scan history.{'\n'}This action cannot be undone.</Text>
          </View>
        </ScrollView>
      </View>
      <TabBar />
    </View>
  );

  // --- MAIN RENDER ---
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar
        barStyle={currentScreen === 'landing' ? 'dark-content' : 'light-content'}
        backgroundColor={currentScreen === 'landing' ? COLORS.white : COLORS.primary}
      />
      {/* Phone-frame wrapper: constrains content to 430 px and centers it on tablets */}
      <View style={isTablet ? styles.phoneFrame : styles.fill}>
      {currentScreen === 'landing' && renderLanding()}
      {currentScreen === 'home' && renderHome()}
      {currentScreen === 'profile' && renderProfile()}
      {currentScreen === 'upload' && renderUpload()}
      {currentScreen === 'processing' && renderProcessing()}
      {currentScreen === 'analysis' && renderAnalysis()}
      {currentScreen === 'history' && renderHistory()}
      {currentScreen === 'settings' && renderSettings()}

      {/* Terms & Conditions Modal */}
      <Modal visible={showTermsModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.dropdownSheet, { maxHeight: '85%', paddingBottom: 20 }]}>
            <Text style={styles.dropdownTitle}>Terms & Conditions</Text>
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: '80%' }}>
              <Text style={[styles.textSmall, { lineHeight: 22, color: COLORS.subtext }]}>{TC_TEXT}</Text>
            </ScrollView>
            <TouchableOpacity
              style={[styles.btnFull, { marginTop: 16 }]}
              onPress={() => { setTermsAccepted(true); setShowTermsModal(false); }}
            >
              <Text style={styles.btnText}>Accept & Close</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.clearImageBtn, { marginTop: 8 }]}
              onPress={() => setShowTermsModal(false)}
            >
              <Text style={styles.clearImageBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Pending Scan Modal — shown when app reopens online with a saved offline scan */}
      <Modal visible={showPendingScanModal} transparent animationType="fade">
        <View style={[styles.modalOverlay, { justifyContent: 'center', paddingHorizontal: 30 }]}>
          <View style={[styles.dropdownSheet, { borderRadius: 24, paddingBottom: 28 }]}>
            <Text style={styles.dropdownTitle}>Pending Scan Found</Text>
            {pendingScanData && (
              <View style={styles.pendingScanInfo}>
                <Text style={styles.pendingScanDetail}>
                  Area: <Text style={{ fontWeight: '600', color: COLORS.text }}>{pendingScanData.bodyArea}</Text>
                </Text>
                <Text style={styles.pendingScanDetail}>
                  Saved: <Text style={{ fontWeight: '600', color: COLORS.text }}>{new Date(pendingScanData.savedAt).toLocaleString()}</Text>
                </Text>
              </View>
            )}
            <Text style={[styles.textSmall, { lineHeight: 22, marginBottom: 20 }]}>
              You have a stored image that hasn't been analyzed yet. Would you like to continue or take another photo?
            </Text>
            <TouchableOpacity style={styles.btnFull} onPress={handleResumePendingScan}>
              <Text style={styles.btnText}>Continue Analysis</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.clearImageBtn, { marginTop: 8 }]} onPress={handleDiscardPendingScan}>
              <Text style={styles.clearImageBtnText}>Take Another Photo</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Consistency reminder — shown after camera capture preview */}
      <Modal visible={showConsistencyModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.dropdownSheet, { paddingBottom: 30 }]}>
            <Text style={styles.dropdownTitle}>Before You Scan</Text>
            <Text style={[styles.textSmall, { lineHeight: 22, marginBottom: 20 }]}>
              Consistency in uploading images is encouraged to ensure accurate results.{'\n\n'}Try to scan the same area under similar lighting and distance each time.
            </Text>
            <TouchableOpacity
              style={styles.btnFull}
              onPress={() => {
                setShowConsistencyModal(false);
                if (capturedImageUri) handleAnalyze(capturedImageUri);
              }}
            >
              <Text style={styles.btnText}>OK, Analyze</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.clearImageBtn, { marginTop: 8 }]}
              onPress={() => { setShowConsistencyModal(false); setCapturedImageUri(null); }}
            >
              <Text style={styles.clearImageBtnText}>Retake Photo</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* PIN Entry Modal */}
      <Modal visible={showPinModal} transparent animationType="fade">
        <View style={[styles.modalOverlay, { justifyContent: 'center', paddingHorizontal: 30 }]}>
          <View style={[styles.dropdownSheet, { borderRadius: 24 }]}>
            <Text style={styles.dropdownTitle}>Enter PIN</Text>
            {pendingProfileId && (
              <Text style={[styles.subtext, { textAlign: 'center', marginBottom: 4, marginTop: -8 }]}>
                {profiles.find(p => p.id === pendingProfileId)?.name ?? ''}
              </Text>
            )}
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16, marginVertical: 24 }}>
              {[0, 1, 2, 3].map(i => (
                <View key={i} style={[styles.pinDot, pinInput.length > i && styles.pinDotFilled]} />
              ))}
            </View>
            <TextInput
              ref={pinInputRef}
              value={pinInput}
              onChangeText={v => {
                if (!/^\d*$/.test(v) || v.length > 4) return;
                setPinInput(v);
                setPinError('');
                if (v.length === 4) setTimeout(() => handlePinConfirm(v), 150);
              }}
              keyboardType="number-pad"
              maxLength={4}
              secureTextEntry
              autoFocus
              caretHidden
              style={[styles.inputField, { textAlign: 'center', fontSize: 22, letterSpacing: 14, color: COLORS.text }]}
              placeholder="• • • •"
              placeholderTextColor={COLORS.border}
            />
            {!!pinError && <Text style={styles.pinErrorText}>{pinError}</Text>}
            <TouchableOpacity
              style={[styles.clearImageBtn, { marginTop: 12 }]}
              onPress={() => { setShowPinModal(false); setPendingProfileId(null); setPinInput(''); setPinError(''); }}
            >
              <Text style={styles.clearImageBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Profile Add/Edit Modal — global, renders over any screen */}
      <Modal visible={showProfileModal} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowProfileModal(false)}>
            <View style={[styles.dropdownSheet, { paddingBottom: 40, maxHeight: '90%' }]}>
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <Text style={styles.dropdownTitle}>{editingProfile ? 'Edit Profile' : 'Add Profile'}</Text>
                <TextInput
                  style={styles.inputField}
                  placeholder="Name / Nickname"
                  placeholderTextColor="#AAAAAA"
                  value={formName}
                  onChangeText={setFormName}
                />
                <TextInput
                  style={styles.inputField}
                  placeholder="Age"
                  placeholderTextColor="#AAAAAA"
                  keyboardType="number-pad"
                  value={formAge}
                  onChangeText={t => setFormAge(t.replace(/[^0-9]/g, ''))}
                  maxLength={3}
                />
                <TextInput
                  style={styles.inputField}
                  placeholder="4-Digit PIN"
                  placeholderTextColor="#AAAAAA"
                  keyboardType="number-pad"
                  secureTextEntry
                  value={formPin}
                  onChangeText={t => { if (/^\d{0,4}$/.test(t)) setFormPin(t); }}
                  maxLength={4}
                />
                <DropdownField placeholder="Sex" value={formSex} options={['Male', 'Female', 'Rather not say']} onSelect={setFormSex} />
                <DropdownField placeholder="Skin Type" value={formSkinType} options={['Dry', 'Oily', 'Normal', 'Sensitive']} onSelect={setFormSkinType} />
                <Text style={[styles.dropdownTitle, { fontSize: 14, marginTop: 8, marginBottom: 4 }]}>Sun &amp; Lifestyle</Text>
                <DropdownField placeholder="Daily sun exposure duration" value={formSunExposure} options={SUN_EXPOSURE_OPTIONS} onSelect={setFormSunExposure} />
                <DropdownField placeholder="Sunscreen use" value={formSunscreenUse} options={SUNSCREEN_USE_OPTIONS} onSelect={setFormSunscreenUse} />
                <DropdownField placeholder="How many times a week do you go out?" value={formOutdoorFrequency} options={OUTDOOR_FREQUENCY_OPTIONS} onSelect={setFormOutdoorFrequency} />
                <DropdownField placeholder="Last time you had sunburn" value={formLastSunburn} options={LAST_SUNBURN_OPTIONS} onSelect={setFormLastSunburn} />
                <TouchableOpacity style={[styles.btnFull, { marginTop: 20 }]} onPress={handleSaveProfile}>
                  <Text style={styles.btnText}>{editingProfile ? 'Save Changes' : 'Add Profile'}</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>
      </View>
    </SafeAreaView>
  );
};

// --- STYLES ---
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.primary },
  fullScreen: { flex: 1, backgroundColor: COLORS.primary },
  innerCanvas: {
    flex: 1, backgroundColor: COLORS.white, borderRadius: 30, overflow: 'hidden',
    marginHorizontal: 15, marginTop: 15, marginBottom: 5,
  },
  scrollContainer: { flex: 1, paddingHorizontal: sp(20), paddingTop: sp(20) },

  // Text
  dashboardTitle: { fontSize: sp(26), fontWeight: 'bold', color: COLORS.text, marginBottom: 5 },
  subtext: { color: COLORS.subtext, fontSize: sp(14), marginBottom: 20 },
  centerSubtext: { color: COLORS.subtext, fontSize: sp(12), textAlign: 'center', marginTop: 10 },
  textSmall: { color: COLORS.text, fontSize: sp(14) },
  sectionHeader: { fontSize: sp(18), fontWeight: 'bold', color: COLORS.text, marginBottom: 10 },

  // Cards
  cardBlock: { backgroundColor: COLORS.card, borderRadius: 20, padding: sp(20), borderWidth: 1, borderColor: COLORS.border, marginBottom: 20 },
  outlinedCard: { backgroundColor: COLORS.card, borderRadius: 20, padding: sp(20), borderWidth: 1, borderColor: COLORS.border, marginBottom: 20 },
  cardTitle: { fontSize: sp(16), fontWeight: 'bold', color: COLORS.text, marginBottom: 10 },
  cardLabel: { color: COLORS.subtext, fontSize: sp(12), marginBottom: 5 },
  cardValue: { fontWeight: 'bold', fontSize: sp(20), color: COLORS.text },

  // Buttons
  btnFull: { backgroundColor: COLORS.primary, width: '100%', height: sp(55), borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  btnDanger: { backgroundColor: COLORS.riskHigh, width: '100%', height: sp(50), borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginTop: 15 },
  btnText: { color: COLORS.white, fontSize: sp(16), fontWeight: '600' },

  // Input — minHeight + paddingVertical instead of fixed height so text never clips on tablets
  inputField: {
    backgroundColor: COLORS.card, minHeight: sp(54), borderRadius: 10,
    paddingHorizontal: sp(15), paddingVertical: sp(13), marginBottom: sp(15),
    borderWidth: 1, borderColor: COLORS.border, color: COLORS.text,
    fontSize: sp(15), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },

  // Dropdown modal — bottom sheet on phones, centered card on tablets
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  dropdownSheet: {
    backgroundColor: COLORS.white, padding: sp(20), paddingBottom: sp(36),
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
  },
  dropdownTitle: { fontSize: sp(17), fontWeight: '700', color: COLORS.text, marginBottom: sp(16) },
  dropdownItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: sp(14), paddingHorizontal: 12, borderRadius: 10, marginBottom: 4 },
  dropdownItemText: { fontSize: sp(15), color: COLORS.text },

  // Body part chips
  bodyPartScroll: { flexGrow: 0, marginBottom: 4 },
  bodyPartChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.white },
  bodyPartChipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  bodyPartChipText: { fontSize: sp(13), color: COLORS.subtext, fontWeight: '500' },
  bodyPartChipTextActive: { color: COLORS.white },
  addBodyPartChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: COLORS.primary, backgroundColor: COLORS.white },
  addBodyPartText: { fontSize: sp(13), color: COLORS.primary, fontWeight: '600' },

  // Upload
  uploadModeRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  modePill: { flex: 1, height: 44, borderRadius: 10, borderWidth: 1.5, borderColor: COLORS.border, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.bg },
  modePillActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  modePillText: { fontSize: sp(14), color: COLORS.subtext, fontWeight: '500' },
  modePillTextActive: { color: COLORS.white, fontWeight: '600' },
  cameraPlaceholder: { width: '100%', height: 200, backgroundColor: '#EFEFEF', borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginVertical: 10, overflow: 'hidden', borderWidth: 2, borderColor: COLORS.border, borderStyle: 'dashed' },
  cameraControls: { position: 'absolute', top: 10, right: 10, gap: 8, zIndex: 10 },
  cameraControlBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' },
  cameraControlText: { fontSize: 16 },
  clearImageBtn: { backgroundColor: COLORS.border, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginTop: 6 },
  clearImageBtnText: { color: COLORS.subtext, fontWeight: '500', fontSize: sp(13) },

  // Analysis tabs
  customTabBar: { flexDirection: 'row', backgroundColor: '#EFEFEF', borderRadius: 20, padding: 4, marginBottom: 20 },
  customTab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 16 },
  customTabActive: { backgroundColor: COLORS.card, elevation: 2 },
  customTabText: { color: COLORS.subtext, fontWeight: '600', fontSize: 14 },
  customTabTextActive: { color: COLORS.text },

  // Tab bar
  tabBar: { height: 70, backgroundColor: 'transparent', flexDirection: 'row', paddingBottom: 10 },
  tabItem: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  tabIcon: { width: 24, height: 24, resizeMode: 'contain', marginBottom: 4 },
  tabText: { fontSize: sp(10), color: COLORS.text, fontWeight: '500' },

  // Processing
  processingCard: { backgroundColor: COLORS.card, width: '100%', padding: 40, borderRadius: 20, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, elevation: 4 },
  progressBarBg: { width: '100%', height: 6, backgroundColor: COLORS.border, borderRadius: 3, marginTop: 20 },
  progressBarFill: { height: '100%', backgroundColor: COLORS.primary, borderRadius: 3 },

  // Results
  bulletText: { color: COLORS.text, fontSize: sp(13), marginBottom: 4 },
  resultRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  resultText: { color: COLORS.text, fontSize: sp(14) },
  recommendationBubble: { backgroundColor: COLORS.white, padding: 15, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: COLORS.border },
  warningBox: { backgroundColor: '#FFEBEB', padding: 15, borderRadius: 12, borderWidth: 1, borderColor: COLORS.riskHigh, marginTop: 5 },
  warningText: { color: COLORS.riskHigh, fontSize: 13, fontWeight: '500', textAlign: 'center' },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: COLORS.border },

  // Landing
  logoArea: { flex: 2, justifyContent: 'center', alignItems: 'center' },
  appLogo: { width: 200, height: 200 },
  bottomHero: { flex: 1, padding: 40, alignItems: 'center' },
  welcomeTitle: { fontSize: sp(24), fontWeight: 'bold', marginBottom: 30, color: COLORS.text },

  // Home
  scoreCard: { backgroundColor: COLORS.card, borderRadius: 20, padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, marginBottom: 20 },
  scoreCircle: { width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: COLORS.primary, justifyContent: 'center', alignItems: 'center', padding: 6 },
  scoreNum: { fontSize: sp(20), fontWeight: 'bold' },
  scoreTotal: { fontSize: sp(10), color: COLORS.subtext },
  scoreLabel: { fontSize: sp(8), color: COLORS.subtext },
  tipRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tipBullet: { color: COLORS.primary, fontSize: sp(18), marginRight: 12 },
  tipText: { color: COLORS.text, flex: 1, fontSize: sp(14) },
  disclaimerText: { color: COLORS.subtext, fontSize: 11, textAlign: 'center', marginBottom: 16, fontStyle: 'italic' },
  pinDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: COLORS.border, backgroundColor: COLORS.bg },
  pinDotFilled: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  pinErrorText: { color: COLORS.riskHigh, fontSize: 13, textAlign: 'center', marginBottom: 8 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, paddingTop: 60 },
  emptyStateTitle: { fontSize: sp(20), fontWeight: 'bold', color: COLORS.text, marginBottom: 12 },
  emptyStateText: { fontSize: sp(14), color: COLORS.subtext, textAlign: 'center', lineHeight: sp(22) },

  // Profile screen
  profileHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 5 },
  addProfileBtn: { borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 },
  addProfileBtnText: { color: COLORS.primary, fontWeight: '600', fontSize: 13 },
  profileCard: { backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, padding: 16, marginBottom: 12 },
  profileCardActive: { borderColor: COLORS.primary, borderWidth: 2 },
  profileCardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  profileIconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.secondary, justifyContent: 'center', alignItems: 'center' },
  profileIconText: { fontSize: 20 },
  profileName: { fontSize: sp(16), fontWeight: 'bold', color: COLORS.text, marginBottom: 6 },
  profileStats: { flexDirection: 'row', gap: 20 },
  profileStat: {},
  profileStatLabel: { fontSize: sp(11), color: COLORS.subtext, marginBottom: 2 },
  profileStatValue: { fontSize: sp(13), fontWeight: '600', color: COLORS.text },
  profileSunTag: { backgroundColor: COLORS.secondary, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  profileSunTagText: { fontSize: sp(11), color: COLORS.accent, fontWeight: '500' },
  profileMenuBtn: { padding: 4 },
  profileMenuIcon: { fontSize: 22, color: COLORS.subtext, lineHeight: 28 },

  // Tablet phone-frame
  phoneFrame: { flex: 1, width: 430, alignSelf: 'center' },
  fill: { flex: 1 },

  // T&C checkbox
  checkboxRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 18, paddingHorizontal: 4, gap: 10 },
  checkbox: {
    width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: COLORS.primary,
    justifyContent: 'center', alignItems: 'center', marginTop: 1, flexShrink: 0,
    backgroundColor: COLORS.white,
  },
  checkboxChecked: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  checkboxLabel: { flex: 1, fontSize: sp(13), color: COLORS.subtext, lineHeight: 20 },
  linkText: { color: COLORS.accent, fontWeight: '600', textDecorationLine: 'underline' },
  btnDisabled: { opacity: 0.45 },

  // Print / Share button (analysis screen)
  printBtn: {
    borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 7, marginTop: 4,
  },
  printBtnText: { color: COLORS.primary, fontWeight: '600', fontSize: sp(13) },

  // Pending scan info block
  pendingScanInfo: {
    backgroundColor: COLORS.secondary + '60', borderRadius: 12, padding: 12,
    marginBottom: 14, gap: 4,
  },
  pendingScanDetail: { fontSize: sp(13), color: COLORS.subtext },

  // History
  historyBtn: { borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: 12, height: 44, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  historyBtnText: { color: COLORS.primary, fontWeight: '600', fontSize: sp(14) },
  areaTag: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, marginTop: 6 },
  areaTagText: { color: COLORS.text, fontSize: sp(14), fontWeight: '500' },
  historyCard: { backgroundColor: COLORS.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: COLORS.border, marginBottom: 12 },
  historyCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  historyCardDate: { fontSize: sp(16), fontWeight: 'bold', color: COLORS.text },
  historyCardMetrics: { flexDirection: 'row', justifyContent: 'space-between' },
  historyMetric: { alignItems: 'center' },
  historyMetricLabel: { fontSize: sp(11), color: COLORS.subtext, marginBottom: 4 },
  historyMetricValue: { fontSize: sp(14), fontWeight: 'bold', color: COLORS.text },
});

export default PixelDermApp;
