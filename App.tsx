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
  Switch,
  Image,
  Alert,
  Modal,
  FlatList,
} from 'react-native';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import * as ImagePicker from 'react-native-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getOrCreateUserId, analyzeImage, type AnalyzeResult } from './src/api';

const STORAGE_KEYS = {
  analysisResult: '@pixelderm_last_analysis',
  monitoredParts: '@pixelderm_monitored_parts',
  activePart:     '@pixelderm_active_part',
  profile:        '@pixelderm_profile',
  onboarded:      '@pixelderm_onboarded',
};

// --- THEME COLORS ---
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

// --- DROPDOWN COMPONENT ---
const DropdownField = ({ placeholder, value, options, onSelect }) => {
  const [visible, setVisible] = useState(false);

  return (
    <>
      <TouchableOpacity
        style={styles.inputField}
        onPress={() => setVisible(true)}
        activeOpacity={0.8}
      >
        <Text style={{ color: value ? COLORS.text : '#AAAAAA', fontSize: 15 }}>
          {value || placeholder}
        </Text>
        <Text style={{ color: COLORS.subtext, fontSize: 12 }}>▼</Text>
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setVisible(false)}
        >
          <View style={styles.dropdownSheet}>
            <Text style={styles.dropdownTitle}>{placeholder}</Text>
            {options.map((opt) => (
              <TouchableOpacity
                key={opt}
                style={[
                  styles.dropdownItem,
                  value === opt && { backgroundColor: COLORS.secondary },
                ]}
                onPress={() => {
                  onSelect(opt);
                  setVisible(false);
                }}
              >
                <Text style={[styles.dropdownItemText, value === opt && { color: COLORS.accent, fontWeight: '600' }]}>
                  {opt}
                </Text>
                {value === opt && <Text style={{ color: COLORS.accent }}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
};

// --- BODY PART SELECTOR COMPONENT ---
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
        <Text style={[styles.bodyPartChipText, activePart === part && styles.bodyPartChipTextActive]}>
          {part}
        </Text>
      </TouchableOpacity>
    ))}
    <TouchableOpacity style={styles.addBodyPartChip} onPress={onAdd}>
      <Text style={styles.addBodyPartText}>+ Add Area</Text>
    </TouchableOpacity>
  </ScrollView>
);

// --- BODY PART OPTIONS MODAL ---
const AVAILABLE_BODY_PARTS = [
  'Face', 'Neck', 'Left Arm', 'Right Arm', 'Left Hand', 'Right Hand',
  'Chest', 'Back', 'Abdomen', 'Left Leg', 'Right Leg', 'Left Foot', 'Right Foot',
];

const PixelDermApp = () => {
  // --- APP STATE ---
  const [currentScreen, setCurrentScreen] = useState('landing');
  const [analysisTab, setAnalysisTab] = useState('results');
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [selectedImage, setSelectedImage] = useState(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalyzeResult | null>(null);
  const [progress, setProgress] = useState(0);
  const progressRef = useRef(0);

  // Input screen state
  const [age, setAge] = useState('');
  const [sex, setSex] = useState('');
  const [skinType, setSkinType] = useState('');

  // Body parts state
  const [monitoredParts, setMonitoredParts] = useState(['Face']);
  const [activePart, setActivePart] = useState('Face');
  const [showAddPartModal, setShowAddPartModal] = useState(false);

  // Upload screen: camera vs gallery mode
  const [uploadMode, setUploadMode] = useState(null); // null | 'camera' | 'gallery'
  const [cameraPosition, setCameraPosition] = useState<'back' | 'front'>('back');
  const [torchOn, setTorchOn] = useState(false);

  // --- CAMERA HOOKS ---
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice(cameraPosition);

  useEffect(() => {
    if (currentScreen === 'upload' && uploadMode === 'camera' && !hasPermission) {
      requestPermission();
    }
  }, [currentScreen, uploadMode, hasPermission]);

  useEffect(() => {
    if (currentScreen !== 'upload') {
      setSelectedImage(null);
      setUploadMode(null);
      setCameraPosition('back');
      setTorchOn(false);
    }
  }, [currentScreen]);

  // Restore persisted state on mount
  useEffect(() => {
    const restore = async () => {
      try {
        await getOrCreateUserId().then(setUserId);

        const [savedAnalysis, savedParts, savedActive, savedProfile, savedOnboarded] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.analysisResult),
          AsyncStorage.getItem(STORAGE_KEYS.monitoredParts),
          AsyncStorage.getItem(STORAGE_KEYS.activePart),
          AsyncStorage.getItem(STORAGE_KEYS.profile),
          AsyncStorage.getItem(STORAGE_KEYS.onboarded),
        ]);

        if (savedAnalysis) setAnalysisResult(JSON.parse(savedAnalysis));
        if (savedParts)    setMonitoredParts(JSON.parse(savedParts));
        if (savedActive)   setActivePart(savedActive);
        if (savedProfile) {
          const p = JSON.parse(savedProfile);
          if (p.age)      setAge(p.age);
          if (p.sex)      setSex(p.sex);
          if (p.skinType) setSkinType(p.skinType);
        }
        if (savedOnboarded === 'true') setCurrentScreen('home');
      } catch (e) {
        console.error('Failed to restore session:', e);
      }
    };
    restore();
  }, []);

  // Persist state whenever it changes
  useEffect(() => {
    if (analysisResult)
      AsyncStorage.setItem(STORAGE_KEYS.analysisResult, JSON.stringify(analysisResult)).catch(() => {});
  }, [analysisResult]);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEYS.monitoredParts, JSON.stringify(monitoredParts)).catch(() => {});
  }, [monitoredParts]);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEYS.activePart, activePart).catch(() => {});
  }, [activePart]);

  // --- ACTION HANDLERS ---
  const handleCapture = async () => {
    // Reset and start progress animation
    progressRef.current = 0;
    setProgress(0);
    setCurrentScreen('processing');

    // Ease toward 90% while waiting for the API — slows as it approaches the cap
    const timer = setInterval(() => {
      const next = progressRef.current + (90 - progressRef.current) * 0.08;
      progressRef.current = next;
      setProgress(Math.round(next));
    }, 120);

    try {
      const uid = userId ?? (await getOrCreateUserId());
      if (!userId) setUserId(uid);

      const imageUri = (selectedImage as any)?.uri;
      if (imageUri) {
        const result = await analyzeImage(imageUri, uid, activePart);
        setAnalysisResult(result);
      }
    } catch (e: any) {
      Alert.alert('Analysis Error', e.message);
    } finally {
      clearInterval(timer);
      progressRef.current = 100;
      setProgress(100);
      // Brief pause at 100% before navigating
      setTimeout(() => setCurrentScreen('analysis'), 400);
    }
  };

  const handlePickFromGallery = () => {
    const options = { mediaType: 'photo', maxWidth: 1000, maxHeight: 1000, quality: 0.8 };
    ImagePicker.launchImageLibrary(options, (response) => {
      if (response.didCancel) return;
      if (response.errorCode) {
        Alert.alert('Error', 'Failed to pick image: ' + response.errorMessage);
        return;
      }
      if (response.assets?.length > 0) {
        const asset = response.assets[0];
        const fileSizeInMB = (asset.fileSize || 0) / (1024 * 1024);
        if (fileSizeInMB > 5) {
          Alert.alert('Error', 'Image size exceeds 5MB limit');
          return;
        }
        setSelectedImage({ uri: asset.uri, fileName: asset.fileName });
        setUploadMode('gallery');
      }
    });
  };

  const handleSwitchToCamera = () => {
    setSelectedImage(null);
    setUploadMode('camera');
  };

  const handleAddBodyPart = (part) => {
    if (!monitoredParts.includes(part)) {
      setMonitoredParts([...monitoredParts, part]);
    }
    setActivePart(part);
    setShowAddPartModal(false);
  };

  // --- REUSABLE COMPONENTS ---
  const TabBar = () => (
    <View style={styles.tabBar}>
      {[
        { screen: 'home', label: 'Home', iconDefault: require('./assets/icons/home_logo.png'), iconActive: require('./assets/icons/homeShaded_logo.png') },
        { screen: 'upload', label: 'Upload Skin', iconDefault: require('./assets/icons/uploadSkin_logo.png'), iconActive: require('./assets/icons/uploadSkinShaded_logo.png') },
        { screen: 'profile', label: 'Profile', iconDefault: require('./assets/icons/user_logo.png'), iconActive: require('./assets/icons/userShaded_logo.png') },
        { screen: 'settings', label: 'Settings', iconDefault: require('./assets/icons/setting_logo.png'), iconActive: require('./assets/icons/settingShaded_logo.png') },
      ].map(({ screen, label, iconDefault, iconActive }) => {
        const active = currentScreen === screen;
        return (
          <TouchableOpacity
            key={screen}
            onPress={() => setCurrentScreen(screen)}
            style={styles.tabItem}
          >
            <Image source={active ? iconActive : iconDefault} style={styles.tabIcon} />
            <Text style={[styles.tabText, active && { color: COLORS.accent }]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  // --- SCREEN RENDERERS ---
  const renderLanding = () => (
    <View style={[styles.fullScreen, { backgroundColor: COLORS.white }]}>
      <View style={styles.logoArea}>
        <Image
          source={require('./assets/icons/pixelDerm_logo.png')}
          style={styles.appLogo}
          resizeMode="contain"
        />
      </View>
      <View style={styles.bottomHero}>
        <Text style={styles.welcomeTitle}>Welcome to PixelDerm!</Text>
        <TouchableOpacity style={styles.btnFull} onPress={() => setCurrentScreen('input')}>
          <Text style={styles.btnText}>Get Started</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ── INPUT SCREEN ──────────────────────────────────────────────────────────
  const renderInput = () => (
    <View style={[styles.fullScreen, { backgroundColor: COLORS.white }]}>
      <View style={styles.formContent}>
        <Text style={styles.screenHeader}>Your Profile</Text>
        <Text style={styles.inputLabel}>Enter your information to get started</Text>

        {/* Age — numpad only */}
        <TextInput
          style={styles.inputField}
          placeholder="Age"
          placeholderTextColor="#AAAAAA"
          keyboardType="number-pad"
          value={age}
          onChangeText={(t) => setAge(t.replace(/[^0-9]/g, ''))}
          maxLength={3}
        />

        {/* Sex — dropdown */}
        <DropdownField
          placeholder="Sex"
          value={sex}
          options={['Male', 'Female', 'Rather not say']}
          onSelect={setSex}
        />

        {/* Skin Type — dropdown */}
        <DropdownField
          placeholder="Skin Type"
          value={skinType}
          options={['Dry', 'Oily', 'Normal', 'Sensitive']}
          onSelect={setSkinType}
        />

        <TouchableOpacity
          style={[styles.btnFull, { marginTop: 40 }]}
          onPress={async () => {
            await Promise.all([
              AsyncStorage.setItem(STORAGE_KEYS.profile, JSON.stringify({ age, sex, skinType })),
              AsyncStorage.setItem(STORAGE_KEYS.onboarded, 'true'),
            ]).catch(() => {});
            setCurrentScreen('home');
          }}
        >
          <Text style={styles.btnText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // ── HOME SCREEN ───────────────────────────────────────────────────────────
  const renderHome = () => (
    <View style={styles.fullScreen}>
      <View style={styles.innerCanvas}>
        <View style={{ paddingHorizontal: 20, paddingTop: 20 }}>
          <Text style={styles.dashboardTitle}>Homepage</Text>
          <Text style={styles.sectionHeader}>Monitoring Areas</Text>
        </View>

        {/* Horizontal chip bar lives outside ScrollView so it doesn't clip */}
        <BodyPartTab
          parts={monitoredParts}
          activePart={activePart}
          onSelect={setActivePart}
          onAdd={() => setShowAddPartModal(true)}
        />

        <ScrollView style={[styles.scrollContainer, { marginTop: 0 }]} showsVerticalScrollIndicator={false}>
          {analysisResult ? (
            <>
              {/* Per-part data card */}
              <View style={[styles.cardBlock, { marginTop: 4 }]}>
                <Text style={[styles.cardTitle, { marginBottom: 2 }]}>{activePart}</Text>
                <Text style={styles.textSmall}>
                  Last scanned: {new Date(analysisResult.analysis.timestamp).toLocaleDateString()}
                </Text>
              </View>

              <View style={styles.scoreCard}>
                <View>
                  <Text style={styles.cardLabel}>Last Analysis</Text>
                  <Text style={styles.cardValue}>
                    {new Date(analysisResult.analysis.timestamp).toLocaleString()}
                  </Text>
                </View>
                <View style={styles.scoreCircle}>
                  <Text style={[styles.scoreNum, { color: COLORS.text }]}>
                    {Math.min(100, Math.round(analysisResult.features.textureScore * 100))}
                  </Text>
                  <Text style={styles.scoreTotal}>/100</Text>
                  <Text style={styles.scoreLabel}>UV Damage</Text>
                </View>
              </View>

              <Text style={styles.sectionHeader}>Tips</Text>
              <View style={styles.cardBlock}>
                {analysisResult.recommendation.advice
                  .split(/\.\s+/)
                  .filter(Boolean)
                  .map((tip, i) => (
                    <View key={i} style={styles.tipRow}>
                      <Text style={styles.tipBullet}>•</Text>
                      <Text style={styles.tipText}>{tip}</Text>
                    </View>
                  ))}
              </View>
            </>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateTitle}>No scans yet</Text>
              <Text style={styles.emptyStateText}>
                Take your first photo to see your skin analysis, scores, and personalized tips here.
              </Text>
              <TouchableOpacity
                style={[styles.btnFull, { marginTop: 20 }]}
                onPress={() => setCurrentScreen('upload')}
              >
                <Text style={styles.btnText}>Take First Scan</Text>
              </TouchableOpacity>
            </View>
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
      <TabBar />

      {/* Add Body Part Modal */}
      <Modal visible={showAddPartModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.dropdownSheet, { maxHeight: '75%' }]}>
            <Text style={styles.dropdownTitle}>Add a Body Area to Monitor</Text>
            <FlatList
              data={AVAILABLE_BODY_PARTS.filter((p) => !monitoredParts.includes(p))}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.dropdownItem} onPress={() => handleAddBodyPart(item)}>
                  <Text style={styles.dropdownItemText}>{item}</Text>
                  <Text style={{ color: COLORS.primary }}>+ Add</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={[styles.textSmall, { textAlign: 'center', padding: 20, color: COLORS.subtext }]}>
                  All available areas are already being monitored.
                </Text>
              }
            />
            <TouchableOpacity
              style={[styles.btnFull, { marginTop: 10, marginBottom: 0 }]}
              onPress={() => setShowAddPartModal(false)}
            >
              <Text style={styles.btnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );

  const renderProfile = () => (
    <View style={styles.fullScreen}>
      <View style={styles.innerCanvas}>
        <ScrollView style={styles.scrollContainer}>
          <Text style={styles.dashboardTitle}>Profile</Text>
          <Text style={styles.subtext}>Edit your information</Text>
          <View style={[styles.cardBlock, { marginTop: 20 }]}>
            <View style={styles.statLine}><Text style={styles.statLabel}>Age</Text><Text style={styles.statVal}>{age ? `${age} years old` : '—'}</Text></View>
            <View style={styles.statLine}><Text style={styles.statLabel}>Sex</Text><Text style={styles.statVal}>{sex || '—'}</Text></View>
            <View style={[styles.statLine, { borderBottomWidth: 0 }]}><Text style={styles.statLabel}>Skin type</Text><Text style={styles.statVal}>{skinType || '—'}</Text></View>
          </View>
        </ScrollView>
      </View>
      <TabBar />
    </View>
  );

  // ── UPLOAD SCREEN ─────────────────────────────────────────────────────────
  const renderUpload = () => (
    <View style={styles.fullScreen}>
      <View style={styles.innerCanvas}>
        <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
          <Text style={styles.dashboardTitle}>Skin Analysis</Text>
          <Text style={styles.subtext}>Take a photo or upload from gallery</Text>

          <View style={styles.outlinedCard}>
            <Text style={styles.cardTitle}>Image of Skin</Text>

            {/* Mode toggle buttons */}
            <View style={styles.uploadModeRow}>
              <TouchableOpacity
                style={[styles.modePill, uploadMode === 'camera' && styles.modePillActive]}
                onPress={handleSwitchToCamera}
              >
                <Text style={[styles.modePillText, uploadMode === 'camera' && styles.modePillTextActive]}>
                  Camera
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modePill, uploadMode === 'gallery' && styles.modePillActive]}
                onPress={handlePickFromGallery}
              >
                <Text style={[styles.modePillText, uploadMode === 'gallery' && styles.modePillTextActive]}>
                  Gallery
                </Text>
              </TouchableOpacity>
            </View>

            {/* Preview / Camera area */}
            <View style={styles.cameraPlaceholder}>
              {uploadMode === null && (
                <Text style={{ color: COLORS.subtext, textAlign: 'center', paddingHorizontal: 20 }}>
                  Select Camera or Gallery above to get started
                </Text>
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
                        photo={true}
                        torch={torchOn ? 'on' : 'off'}
                      />
                      <View style={styles.cameraControls}>
                        {cameraPosition === 'back' && (
                          <TouchableOpacity
                            style={[styles.cameraControlBtn, torchOn && styles.cameraControlBtnActive]}
                            onPress={() => setTorchOn(v => !v)}
                          >
                            <Text style={styles.cameraControlText}>⚡</Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          style={styles.cameraControlBtn}
                          onPress={() => {
                            setTorchOn(false);
                            setCameraPosition(p => p === 'back' ? 'front' : 'back');
                          }}
                        >
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

            {/* Action buttons vary by mode */}
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
    const riskMap: Record<string, { label: string; color: string }> = {
      normal:   { label: 'Low',      color: COLORS.riskLow },
      moderate: { label: 'Moderate', color: COLORS.riskModerate },
    };
    const riskInfo = analysisResult
      ? (riskMap[analysisResult.recommendation.status] ?? { label: 'High', color: COLORS.riskHigh })
      : { label: 'High', color: COLORS.riskHigh };

    const uvScore = analysisResult
      ? Math.min(100, Math.round(analysisResult.features.textureScore * 100))
      : 84;

    const detectedRows = analysisResult
      ? [
          [`${analysisResult.features.spotCount} spot(s) detected`, riskInfo.label],
          [`Texture score: ${analysisResult.features.textureScore}`, riskInfo.label],
          [`Pigmentation: ${analysisResult.features.pigmentation}`, riskInfo.label],
        ]
      : [['Rough skin texture', 'High'], ['Hyperpigmentation', 'High'], ['Wrinkles', 'High']];

    const adviceLines = analysisResult
      ? analysisResult.recommendation.advice.split(/\.\s+/).filter(Boolean)
      : [
          'Apply broad-spectrum SPF 30+ sunscreen daily, even on cloudy days',
          'Reapply sunscreen every 2 hours when outdoors',
          'Wear protective clothing and a wide-brimmed hat when in direct sunlight',
        ];

    return (
    <View style={styles.fullScreen}>
      <View style={styles.innerCanvas}>
        <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
          <Text style={styles.dashboardTitle}>Analysis Complete</Text>
          <Text style={styles.subtext}>Risk level, UV damage score, and results</Text>

          <View style={[styles.outlinedCard, { flexDirection: 'row', justifyContent: 'space-between' }]}>
            <View>
              <Text style={styles.cardLabel}>Risk Level</Text>
              <Text style={[styles.cardValue, { color: riskInfo.color }]}>{riskInfo.label}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.cardLabel}>UV Damage Score</Text>
              <Text style={styles.cardValue}>{uvScore}/100</Text>
            </View>
          </View>

          <View style={styles.customTabBar}>
            {['results', 'comparison'].map((tab) => (
              <TouchableOpacity
                key={tab}
                style={[styles.customTab, analysisTab === tab && styles.customTabActive]}
                onPress={() => setAnalysisTab(tab)}
              >
                <Text style={[styles.customTabText, analysisTab === tab && styles.customTabTextActive]}>
                  {tab === 'results' ? 'Analyzed Results' : 'Comparison'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {analysisTab === 'results' ? (
            <>
              <View style={styles.outlinedCard}>
                <Text style={styles.cardTitle}>Detected Spots and Patterns</Text>
                {detectedRows.map(([label, risk]) => (
                  <View key={label} style={styles.resultRow}>
                    <Text style={styles.resultText}>{label}</Text>
                    <Text style={{ color: riskInfo.color }}>{risk}</Text>
                  </View>
                ))}
              </View>
              <View style={[styles.outlinedCard, { backgroundColor: COLORS.secondary + '40' }]}>
                <Text style={styles.cardTitle}>Recommendations</Text>
                {adviceLines.map((line, i) => (
                  <View key={i} style={styles.recommendationBubble}>
                    <Text style={styles.textSmall}>{line}</Text>
                  </View>
                ))}
                {riskInfo.label === 'High' && (
                  <View style={styles.warningBox}>
                    <Text style={styles.warningText}>Based on the analysis, we recommend consulting a dermatologist for professional evaluation.</Text>
                  </View>
                )}
              </View>
            </>
          ) : (
            <>
              <View style={styles.outlinedCard}>
                <Text style={styles.cardTitle}>Last Scan vs New Scan</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
                  <View style={styles.mockImageSquare}><Text style={styles.centerSubtext}>Image of{'\n'}last scan</Text></View>
                  <View style={styles.mockImageSquare}><Text style={styles.centerSubtext}>Image of{'\n'}new scan</Text></View>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 5, paddingHorizontal: 20 }}>
                  <Text style={styles.centerSubtext}>1/17/25</Text>
                  <Text style={styles.centerSubtext}>1/24/25</Text>
                </View>
              </View>
              <View style={styles.outlinedCard}>
                <Text style={styles.cardTitle}>Changes</Text>
                <View style={styles.recommendationBubble}><Text style={styles.textSmall}>Dark spots increased</Text></View>
                <View style={styles.recommendationBubble}><Text style={styles.textSmall}>Higher roughness in skin texture</Text></View>
              </View>
            </>
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

          <View style={[styles.outlinedCard, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
            <View>
              <Text style={styles.cardTitle}>Notifications</Text>
              <Text style={styles.textSmall}>Toggle push notifications</Text>
            </View>
            <Switch
              value={notificationsEnabled}
              onValueChange={setNotificationsEnabled}
              trackColor={{ false: '#767577', true: COLORS.primary }}
            />
          </View>

          <View style={styles.outlinedCard}>
            <Text style={styles.cardTitle}>Information</Text>
            <TouchableOpacity style={styles.settingRow}>
              <Text style={styles.textSmall}>About UV Skin Analysis</Text>
              <Text style={styles.subtext}>{'>'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.settingRow, { borderBottomWidth: 0, paddingBottom: 0 }]}>
              <Text style={styles.textSmall}>Privacy Policy</Text>
              <Text style={styles.subtext}>{'>'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.outlinedCard}>
            <Text style={styles.cardTitle}>Data Management</Text>
            <TouchableOpacity
              style={styles.btnDanger}
              onPress={() =>
                Alert.alert(
                  'Clear All Data',
                  'This will delete your profile and all scan history. This action cannot be undone.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Clear',
                      style: 'destructive',
                      onPress: async () => {
                        await AsyncStorage.multiRemove([
                          '@pixelderm_user_id',
                          STORAGE_KEYS.analysisResult,
                          STORAGE_KEYS.monitoredParts,
                          STORAGE_KEYS.activePart,
                          STORAGE_KEYS.profile,
                          STORAGE_KEYS.onboarded,
                        ]).catch(() => {});
                        // Reset all state
                        setUserId(null);
                        setAnalysisResult(null);
                        setMonitoredParts(['Face']);
                        setActivePart('Face');
                        setAge('');
                        setSex('');
                        setSkinType('');
                        setCurrentScreen('landing');
                      },
                    },
                  ],
                )
              }
            >
              <Text style={styles.btnText}>Clear All Data</Text>
            </TouchableOpacity>
            <Text style={[styles.centerSubtext, { marginTop: 10, fontSize: 10 }]}>
              This will delete your profile and all scan history.{'\n'}This action cannot be undone.
            </Text>
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
        barStyle={currentScreen === 'landing' || currentScreen === 'input' ? 'dark-content' : 'light-content'}
        backgroundColor={currentScreen === 'landing' || currentScreen === 'input' ? COLORS.white : COLORS.primary}
      />
      {currentScreen === 'landing' && renderLanding()}
      {currentScreen === 'input' && renderInput()}
      {currentScreen === 'home' && renderHome()}
      {currentScreen === 'profile' && renderProfile()}
      {currentScreen === 'upload' && renderUpload()}
      {currentScreen === 'processing' && renderProcessing()}
      {currentScreen === 'analysis' && renderAnalysis()}
      {currentScreen === 'settings' && renderSettings()}
    </SafeAreaView>
  );
};

// --- STYLES ---
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.primary },
  fullScreen: { flex: 1, backgroundColor: COLORS.primary },
  innerCanvas: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderRadius: 30,
    marginHorizontal: 15,
    marginTop: 15,
    marginBottom: 5,
    overflow: 'hidden',
  },
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

  // Input fields
  inputField: {
    backgroundColor: COLORS.card,
    height: 50,
    borderRadius: 10,
    paddingHorizontal: 15,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: COLORS.text,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  // Dropdown modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  dropdownSheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 36,
  },
  dropdownTitle: { fontSize: 17, fontWeight: '700', color: COLORS.text, marginBottom: 16 },
  dropdownItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 4,
  },
  dropdownItemText: { fontSize: 15, color: COLORS.text },

  // Body part chips
  bodyPartScroll: { flexGrow: 0, marginBottom: 4 },
  bodyPartChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  bodyPartChipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  bodyPartChipText: { fontSize: 13, color: COLORS.subtext, fontWeight: '500' },
  bodyPartChipTextActive: { color: COLORS.white },
  addBodyPartChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.white,
  },
  addBodyPartText: { fontSize: 13, color: COLORS.primary, fontWeight: '600' },

  // Upload mode toggle
  uploadModeRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  modePill: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.bg,
  },
  modePillActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  modePillText: { fontSize: 14, color: COLORS.subtext, fontWeight: '500' },
  modePillTextActive: { color: COLORS.white, fontWeight: '600' },

  // Camera / Image
  cameraPlaceholder: {
    width: '100%',
    height: 200,
    backgroundColor: '#EFEFEF',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 10,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  cameraControls: { position: 'absolute', top: 10, right: 10, gap: 8, zIndex: 10 },
  cameraControlBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' },
  cameraControlBtnActive: { backgroundColor: 'rgba(255,210,0,0.75)' },
  cameraControlText: { fontSize: 16 },
  mockImageSquare: { width: '48%', height: 120, backgroundColor: COLORS.bg, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, justifyContent: 'center', alignItems: 'center' },
  clearImageBtn: { backgroundColor: COLORS.border, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginTop: 6 },
  clearImageBtnText: { color: COLORS.subtext, fontWeight: '500', fontSize: 13 },

  // Analysis tabs
  customTabBar: { flexDirection: 'row', backgroundColor: '#EFEFEF', borderRadius: 20, padding: 4, marginBottom: 20 },
  customTab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 16 },
  customTabActive: { backgroundColor: COLORS.card, elevation: 2 },
  customTabText: { color: COLORS.subtext, fontWeight: '600', fontSize: 14 },
  customTabTextActive: { color: COLORS.text },

  // Bottom nav
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

  // Landing / Input
  logoArea: { flex: 2, justifyContent: 'center', alignItems: 'center' },
  appLogo: { width: 200, height: 200 },
  bottomHero: { flex: 1, padding: 40, alignItems: 'center' },
  welcomeTitle: { fontSize: 24, fontWeight: 'bold', marginBottom: 30, color: COLORS.text },
  formContent: { flex: 1, padding: 30, justifyContent: 'center' },
  screenHeader: { fontSize: 22, fontWeight: 'bold', textAlign: 'center', marginBottom: 10, color: COLORS.text },
  inputLabel: { textAlign: 'center', color: COLORS.subtext, marginBottom: 30 },

  // Home
  scoreCard: { backgroundColor: COLORS.card, borderRadius: 20, padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, marginBottom: 20 },
  scoreCircle: { width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: COLORS.primary, justifyContent: 'center', alignItems: 'center', padding: 6 },
  scoreNum: { fontSize: 20, fontWeight: 'bold' },
  scoreTotal: { fontSize: 10, color: COLORS.subtext },
  scoreLabel: { fontSize: 8, color: COLORS.subtext },
  changeText: { color: COLORS.text, fontSize: 15 },
  tipRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tipBullet: { color: COLORS.primary, fontSize: 18, marginRight: 12 },
  tipText: { color: COLORS.text, flex: 1 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, paddingTop: 60 },
  emptyStateTitle: { fontSize: 20, fontWeight: 'bold', color: COLORS.text, marginBottom: 12 },
  emptyStateText: { fontSize: 14, color: COLORS.subtext, textAlign: 'center', lineHeight: 22 },


  // Profile
  statLine: { paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: COLORS.border, flexDirection: 'row', justifyContent: 'space-between' },
  statLabel: { color: COLORS.subtext, fontSize: 16 },
  statVal: { fontSize: 16, fontWeight: '500', color: COLORS.text },
});

export default PixelDermApp;