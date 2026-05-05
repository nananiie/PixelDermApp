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
} from 'react-native';
import { Camera, useCameraDevice, useCameraPermission, usePhotoOutput } from 'react-native-vision-camera';
import * as ImagePicker from 'react-native-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createNewUser, analyzeImage, type AnalyzeResult } from './src/api';

// --- TYPES ---
type Profile = {
  id: string;
  name: string;
  age: string;
  sex: string;
  skinType: string;
  userId: string | null;
  monitoredParts: string[];
  activePart: string;
  lastAnalysis: AnalyzeResult | null;
  scanHistory: Record<string, AnalyzeResult[]>;
};

const STORAGE_KEYS = {
  profiles: '@pixelderm_profiles',
  activeProfileId: '@pixelderm_active_profile_id',
};

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
  // --- STATE ---
  const [currentScreen, setCurrentScreen] = useState('landing');
  const [analysisTab, setAnalysisTab] = useState('results');
  // Upload flow
  const [selectedImage, setSelectedImage] = useState(null);
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
      setUploadMode(null);
      setCameraPosition('back');
    }
  }, [currentScreen]);

  useEffect(() => {
    const restore = async () => {
      try {
        const [profilesStr, activeIdStr] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.profiles),
          AsyncStorage.getItem(STORAGE_KEYS.activeProfileId),
        ]);
        if (profilesStr) {
          const saved = JSON.parse(profilesStr) as Profile[];
          setProfiles(saved);
          if (activeIdStr && saved.find(p => p.id === activeIdStr)) {
            setActiveProfileId(activeIdStr);
            setCurrentScreen('home');
          } else if (saved.length > 0) {
            setActiveProfileId(saved[0].id);
            setCurrentScreen('home');
          }
        }
      } catch (e) {
        console.error('Failed to restore session:', e);
      }
    };
    restore().catch(console.error);
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEYS.profiles, JSON.stringify(profiles)).catch(() => {});
  }, [profiles]);

  useEffect(() => {
    if (activeProfileId) {
      AsyncStorage.setItem(STORAGE_KEYS.activeProfileId, activeProfileId).catch(() => {});
    }
  }, [activeProfileId]);

  // --- HANDLERS ---
  const handleCapture = async () => {
    let imageUri: string | undefined;

    if (uploadMode === 'camera') {
      try {
        const photo = await photoOutput.capturePhoto({ enableShutterSound: false }, {});
        const rawPath = await photo.saveToTemporaryFileAsync();
        imageUri = rawPath.startsWith('file://') ? rawPath : `file://${rawPath}`;
        photo.dispose();
      } catch (e: any) {
        Alert.alert('Camera Error', e.message ?? 'Failed to take photo');
        return;
      }
    } else {
      imageUri = (selectedImage as any)?.uri;
    }

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

    progressRef.current = 0;
    setProgress(0);
    setCurrentScreen('processing');

    const timer = setInterval(() => {
      const next = progressRef.current + (90 - progressRef.current) * 0.08;
      progressRef.current = next;
      setProgress(Math.round(next));
    }, 120);

    let hasError = false;
    try {
      let uid = activeProfile?.userId ?? null;
      if (!uid) {
        uid = await createNewUser();
        updateActiveProfile({ userId: uid });
      }
      const result = await analyzeImage(imageUri, uid, activeProfile?.activePart ?? 'Face');
      const part = activeProfile?.activePart ?? 'Face';
      const prevHistory = activeProfile?.scanHistory ?? {};
      updateActiveProfile({
        lastAnalysis: result,
        scanHistory: { ...prevHistory, [part]: [result, ...(prevHistory[part] ?? [])] },
      });
    } catch (e: any) {
      hasError = true;
      Alert.alert('Analysis Error', e.message);
    } finally {
      clearInterval(timer);
      if (hasError) {
        setCurrentScreen('upload');
      } else {
        progressRef.current = 100;
        setProgress(100);
        setTimeout(() => setCurrentScreen('analysis'), 400);
      }
    }
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
    setFormName(''); setFormAge(''); setFormSex(''); setFormSkinType('');
    setShowProfileModal(true);
  };

  const handleEditProfile = (profile: Profile) => {
    setEditingProfile(profile);
    setFormName(profile.name); setFormAge(profile.age);
    setFormSex(profile.sex); setFormSkinType(profile.skinType);
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
      ...(!isActive ? [{ text: 'Switch to this profile', onPress: () => { setActiveProfileId(profile.id); setCurrentScreen('home'); } }] : []),
      { text: 'Edit', onPress: () => handleEditProfile(profile) },
      { text: 'Delete', style: 'destructive' as const, onPress: () => handleDeleteProfile(profile.id) },
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const handleSaveProfile = () => {
    if (!formName.trim()) { Alert.alert('Error', 'Please enter a name.'); return; }
    if (editingProfile) {
      setProfiles(prev => prev.map(p =>
        p.id === editingProfile.id
          ? { ...p, name: formName.trim(), age: formAge, sex: formSex, skinType: formSkinType }
          : p
      ));
    } else {
      const isFirst = profiles.length === 0;
      const newProfile: Profile = {
        id: `profile-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: formName.trim(), age: formAge, sex: formSex, skinType: formSkinType,
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
        <TouchableOpacity style={styles.btnFull} onPress={handleAddProfile}>
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
                    Next scan recommended: {new Date(new Date(lastAnalysis.analysis.timestamp).getTime() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString()}
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
                <Text style={styles.sectionHeader}>Tips</Text>
                <View style={styles.cardBlock}>
                  {lastAnalysis.recommendation.advice.split(/\.\s+/).filter(Boolean).map((tip, i) => (
                    <View key={i} style={styles.tipRow}>
                      <Text style={styles.tipBullet}>•</Text>
                      <Text style={styles.tipText}>{tip}</Text>
                    </View>
                  ))}
                </View>
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
              onPress={() => { setActiveProfileId(profile.id); setCurrentScreen('home'); }}
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
      <TabBar />
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
            {uploadMode === 'camera' && (
              <TouchableOpacity style={styles.btnFull} onPress={handleCapture}>
                <Text style={styles.btnText}>Take Photo</Text>
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
        </View>
      </View>
      <TabBar />
    </View>
  );

  const renderAnalysis = () => {
    const analysisResult = activeProfile?.lastAnalysis;
    if (!analysisResult) return null;
    const { features, baseline, recommendation, analysis } = analysisResult;
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

    return (
      <View style={styles.fullScreen}>
        <View style={styles.innerCanvas}>
          <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
            <Text style={styles.dashboardTitle}>Analysis Complete</Text>
            <Text style={styles.subtext}>{scanDate}</Text>
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
              </>
            ) : (
              <>
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
      {currentScreen === 'landing' && renderLanding()}
      {currentScreen === 'home' && renderHome()}
      {currentScreen === 'profile' && renderProfile()}
      {currentScreen === 'upload' && renderUpload()}
      {currentScreen === 'processing' && renderProcessing()}
      {currentScreen === 'analysis' && renderAnalysis()}
      {currentScreen === 'history' && renderHistory()}
      {currentScreen === 'settings' && renderSettings()}

      {/* Profile Add/Edit Modal — global, renders over any screen */}
      <Modal visible={showProfileModal} transparent animationType="slide">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowProfileModal(false)}>
          <View style={[styles.dropdownSheet, { paddingBottom: 40 }]}>
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
            <DropdownField placeholder="Sex" value={formSex} options={['Male', 'Female', 'Rather not say']} onSelect={setFormSex} />
            <DropdownField placeholder="Skin Type" value={formSkinType} options={['Dry', 'Oily', 'Normal', 'Sensitive']} onSelect={setFormSkinType} />
            <TouchableOpacity style={[styles.btnFull, { marginTop: 20 }]} onPress={handleSaveProfile}>
              <Text style={styles.btnText}>{editingProfile ? 'Save Changes' : 'Add Profile'}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
};

// --- STYLES ---
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.primary },
  fullScreen: { flex: 1, backgroundColor: COLORS.primary },
  innerCanvas: { flex: 1, backgroundColor: COLORS.white, borderRadius: 30, marginHorizontal: 15, marginTop: 15, marginBottom: 5, overflow: 'hidden' },
  scrollContainer: { flex: 1, paddingHorizontal: 20, paddingTop: 20 },

  // Text
  dashboardTitle: { fontSize: 26, fontWeight: 'bold', color: COLORS.text, marginBottom: 5 },
  subtext: { color: COLORS.subtext, fontSize: 14, marginBottom: 20 },
  centerSubtext: { color: COLORS.subtext, fontSize: 12, textAlign: 'center', marginTop: 10 },
  textSmall: { color: COLORS.text, fontSize: 14 },
  sectionHeader: { fontSize: 18, fontWeight: 'bold', color: COLORS.text, marginBottom: 10 },

  // Cards
  cardBlock: { backgroundColor: COLORS.card, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: COLORS.border, marginBottom: 20 },
  outlinedCard: { backgroundColor: COLORS.card, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: COLORS.border, marginBottom: 20 },
  cardTitle: { fontSize: 16, fontWeight: 'bold', color: COLORS.text, marginBottom: 10 },
  cardLabel: { color: COLORS.subtext, fontSize: 12, marginBottom: 5 },
  cardValue: { fontWeight: 'bold', fontSize: 20, color: COLORS.text },

  // Buttons
  btnFull: { backgroundColor: COLORS.primary, width: '100%', height: 55, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  btnDanger: { backgroundColor: COLORS.riskHigh, width: '100%', height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginTop: 15 },
  btnText: { color: COLORS.white, fontSize: 16, fontWeight: '600' },

  // Input
  inputField: { backgroundColor: COLORS.card, height: 50, borderRadius: 10, paddingHorizontal: 15, marginBottom: 15, borderWidth: 1, borderColor: COLORS.border, color: COLORS.text, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  // Dropdown modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  dropdownSheet: { backgroundColor: COLORS.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36 },
  dropdownTitle: { fontSize: 17, fontWeight: '700', color: COLORS.text, marginBottom: 16 },
  dropdownItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 12, borderRadius: 10, marginBottom: 4 },
  dropdownItemText: { fontSize: 15, color: COLORS.text },

  // Body part chips
  bodyPartScroll: { flexGrow: 0, marginBottom: 4 },
  bodyPartChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.white },
  bodyPartChipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  bodyPartChipText: { fontSize: 13, color: COLORS.subtext, fontWeight: '500' },
  bodyPartChipTextActive: { color: COLORS.white },
  addBodyPartChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: COLORS.primary, backgroundColor: COLORS.white },
  addBodyPartText: { fontSize: 13, color: COLORS.primary, fontWeight: '600' },

  // Upload
  uploadModeRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  modePill: { flex: 1, height: 44, borderRadius: 10, borderWidth: 1.5, borderColor: COLORS.border, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.bg },
  modePillActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  modePillText: { fontSize: 14, color: COLORS.subtext, fontWeight: '500' },
  modePillTextActive: { color: COLORS.white, fontWeight: '600' },
  cameraPlaceholder: { width: '100%', height: 200, backgroundColor: '#EFEFEF', borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginVertical: 10, overflow: 'hidden', borderWidth: 2, borderColor: COLORS.border, borderStyle: 'dashed' },
  cameraControls: { position: 'absolute', top: 10, right: 10, gap: 8, zIndex: 10 },
  cameraControlBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' },
  cameraControlText: { fontSize: 16 },
  clearImageBtn: { backgroundColor: COLORS.border, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginTop: 6 },
  clearImageBtnText: { color: COLORS.subtext, fontWeight: '500', fontSize: 13 },

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
  tabText: { fontSize: 10, color: COLORS.text, fontWeight: '500' },

  // Processing
  processingCard: { backgroundColor: COLORS.card, width: '100%', padding: 40, borderRadius: 20, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, elevation: 4 },
  progressBarBg: { width: '100%', height: 6, backgroundColor: COLORS.border, borderRadius: 3, marginTop: 20 },
  progressBarFill: { height: '100%', backgroundColor: COLORS.primary, borderRadius: 3 },

  // Results
  bulletText: { color: COLORS.text, fontSize: 13, marginBottom: 4 },
  resultRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  resultText: { color: COLORS.text, fontSize: 14 },
  recommendationBubble: { backgroundColor: COLORS.white, padding: 15, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: COLORS.border },
  warningBox: { backgroundColor: '#FFEBEB', padding: 15, borderRadius: 12, borderWidth: 1, borderColor: COLORS.riskHigh, marginTop: 5 },
  warningText: { color: COLORS.riskHigh, fontSize: 13, fontWeight: '500', textAlign: 'center' },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: COLORS.border },

  // Landing
  logoArea: { flex: 2, justifyContent: 'center', alignItems: 'center' },
  appLogo: { width: 200, height: 200 },
  bottomHero: { flex: 1, padding: 40, alignItems: 'center' },
  welcomeTitle: { fontSize: 24, fontWeight: 'bold', marginBottom: 30, color: COLORS.text },

  // Home
  scoreCard: { backgroundColor: COLORS.card, borderRadius: 20, padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, marginBottom: 20 },
  scoreCircle: { width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: COLORS.primary, justifyContent: 'center', alignItems: 'center', padding: 6 },
  scoreNum: { fontSize: 20, fontWeight: 'bold' },
  scoreTotal: { fontSize: 10, color: COLORS.subtext },
  scoreLabel: { fontSize: 8, color: COLORS.subtext },
  tipRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tipBullet: { color: COLORS.primary, fontSize: 18, marginRight: 12 },
  tipText: { color: COLORS.text, flex: 1 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, paddingTop: 60 },
  emptyStateTitle: { fontSize: 20, fontWeight: 'bold', color: COLORS.text, marginBottom: 12 },
  emptyStateText: { fontSize: 14, color: COLORS.subtext, textAlign: 'center', lineHeight: 22 },

  // Profile screen
  profileHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 5 },
  addProfileBtn: { borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 },
  addProfileBtnText: { color: COLORS.primary, fontWeight: '600', fontSize: 13 },
  profileCard: { backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, padding: 16, marginBottom: 12 },
  profileCardActive: { borderColor: COLORS.primary, borderWidth: 2 },
  profileCardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  profileIconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.secondary, justifyContent: 'center', alignItems: 'center' },
  profileIconText: { fontSize: 20 },
  profileName: { fontSize: 16, fontWeight: 'bold', color: COLORS.text, marginBottom: 6 },
  profileStats: { flexDirection: 'row', gap: 20 },
  profileStat: {},
  profileStatLabel: { fontSize: 11, color: COLORS.subtext, marginBottom: 2 },
  profileStatValue: { fontSize: 13, fontWeight: '600', color: COLORS.text },
  profileMenuBtn: { padding: 4 },
  profileMenuIcon: { fontSize: 22, color: COLORS.subtext, lineHeight: 28 },

  // History
  historyBtn: { borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: 12, height: 44, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  historyBtnText: { color: COLORS.primary, fontWeight: '600', fontSize: 14 },
  areaTag: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, marginTop: 6 },
  areaTagText: { color: COLORS.text, fontSize: 14, fontWeight: '500' },
  historyCard: { backgroundColor: COLORS.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: COLORS.border, marginBottom: 12 },
  historyCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  historyCardDate: { fontSize: 16, fontWeight: 'bold', color: COLORS.text },
  historyCardMetrics: { flexDirection: 'row', justifyContent: 'space-between' },
  historyMetric: { alignItems: 'center' },
  historyMetricLabel: { fontSize: 11, color: COLORS.subtext, marginBottom: 4 },
  historyMetricValue: { fontSize: 14, fontWeight: 'bold', color: COLORS.text },
});

export default PixelDermApp;
