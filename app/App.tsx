import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Linking, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Circle } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { useFonts, Orbitron_700Bold, Orbitron_900Black } from '@expo-google-fonts/orbitron';
import { SpaceGrotesk_400Regular, SpaceGrotesk_600SemiBold } from '@expo-google-fonts/space-grotesk';
import { JetBrainsMono_400Regular, JetBrainsMono_600SemiBold } from '@expo-google-fonts/jetbrains-mono';

// Backend URL: set EXPO_PUBLIC_API_URL, or change it in the app (API server field).
const DEFAULT_API = process.env.EXPO_PUBLIC_API_URL || 'https://rugcheck-ud3r.onrender.com';

type Market = { liquidityUsd: number; volume24h: number; ageDays: number | null; name: string; symbol: string; url: string } | null;
type Result = { address: string; chain: string; score: number; verdict: string; flags: string[]; good: string[]; market: Market; extra: { name?: string; symbol?: string } | null; disclaimer: string; sources: Record<string, string>; error?: string };
type HistoryItem = { address: string; name: string; score: number; verdict: string; chain: string; at: number };

const CYAN = '#00f0ff', MAG = '#ff2bd6', MUTED = '#7f8ea8', LINE = 'rgba(0,240,255,0.18)';
const COLORS: Record<string, string> = { 'Likely Legit': '#00ffa3', Caution: '#ffd23f', 'High Risk': '#ff8a3d', 'Likely Scam': '#ff3b5c' };
const F = { h: 'Orbitron_700Bold', hb: 'Orbitron_900Black', b: 'SpaceGrotesk_400Regular', bs: 'SpaceGrotesk_600SemiBold', m: 'JetBrainsMono_400Regular', ms: 'JetBrainsMono_600SemiBold' };
const compact = (n?: number) => (n == null ? 'n/a' : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n)}`);
const glow = (c: string, r = 12) => (Platform.OS === 'web' ? ({ textShadow: `0 0 ${r}px ${c}` } as any) : { textShadowColor: c, textShadowRadius: r, textShadowOffset: { width: 0, height: 0 } });

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function Background({ children }: { children: React.ReactNode }) {
  return (
    <LinearGradient colors={['#0a1424', '#05060a', '#14061a']} locations={[0, 0.5, 1]} style={{ flex: 1 }}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {Array.from({ length: 30 }).map((_, i) => <View key={'h' + i} style={{ position: 'absolute', left: 0, right: 0, top: i * 40, height: 1, backgroundColor: 'rgba(0,240,255,0.05)' }} />)}
        {Array.from({ length: 14 }).map((_, i) => <View key={'v' + i} style={{ position: 'absolute', top: 0, bottom: 0, left: i * 40, width: 1, backgroundColor: 'rgba(0,240,255,0.05)' }} />)}
      </View>
      {children}
    </LinearGradient>
  );
}

function Glass({ children, style, accent = CYAN }: { children: React.ReactNode; style?: any; accent?: string }) {
  return (
    <View style={[s.glass, style]}>
      <LinearGradient colors={[accent, 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.glassAccent} />
      {children}
    </View>
  );
}

function Gauge({ score, color }: { score: number; color: string }) {
  const r = 78, c = 2 * Math.PI * r;
  const prog = useRef(new Animated.Value(0)).current, spin = useRef(new Animated.Value(0)).current, pulse = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    Animated.timing(prog, { toValue: score, duration: 1400, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    const id = prog.addListener(({ value }) => setShown(Math.round(value)));
    Animated.loop(Animated.timing(spin, { toValue: 1, duration: 16000, easing: Easing.linear, useNativeDriver: true })).start();
    Animated.loop(Animated.sequence([Animated.timing(pulse, { toValue: 1, duration: 1200, useNativeDriver: true }), Animated.timing(pulse, { toValue: 0, duration: 1200, useNativeDriver: true })])).start();
    return () => prog.removeListener(id);
  }, [score]);
  const offset = prog.interpolate({ inputRange: [0, 100], outputRange: [c, 0] });
  return (
    <View style={{ width: 210, height: 210, alignItems: 'center', justifyContent: 'center', marginVertical: 14 }}>
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: 105, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(0,240,255,0.35)', transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]} />
      <Animated.View style={{ position: 'absolute', width: 176, height: 176, borderRadius: 88, backgroundColor: color, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.04, 0.12] }) }} />
      <Svg width={190} height={190}>
        <Circle cx={95} cy={95} r={r} stroke="rgba(255,255,255,0.07)" strokeWidth={12} fill="none" />
        <AnimatedCircle cx={95} cy={95} r={r} stroke={color} strokeOpacity={0.25} strokeWidth={22} fill="none" strokeDasharray={`${c}`} strokeDashoffset={offset as any} strokeLinecap="round" rotation={-90} origin="95,95" />
        <AnimatedCircle cx={95} cy={95} r={r} stroke={color} strokeWidth={10} fill="none" strokeDasharray={`${c}`} strokeDashoffset={offset as any} strokeLinecap="round" rotation={-90} origin="95,95" />
      </Svg>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={[{ color, fontSize: 54, fontFamily: F.hb }, glow(color, 18)]}>{shown}</Text>
        <Text style={{ color: MUTED, fontFamily: F.m, fontSize: 10, letterSpacing: 2 }}>RISK / 100</Text>
      </View>
    </View>
  );
}

function Scanning() {
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.loop(Animated.timing(y, { toValue: 1, duration: 1300, easing: Easing.linear, useNativeDriver: true })).start(); }, []);
  return (
    <Glass style={{ marginTop: 16, alignItems: 'center', paddingVertical: 30, overflow: 'hidden' }}>
      <Animated.View style={{ position: 'absolute', left: 0, right: 0, height: 50, transform: [{ translateY: y.interpolate({ inputRange: [0, 1], outputRange: [-50, 130] }) }] }}>
        <LinearGradient colors={['transparent', 'rgba(0,240,255,0.3)', 'transparent']} style={{ flex: 1 }} />
      </Animated.View>
      <ActivityIndicator color={CYAN} />
      <Text style={[{ color: CYAN, fontFamily: F.h, letterSpacing: 5, marginTop: 10 }, glow(CYAN)]}>SCANNING</Text>
      <Text style={{ color: MUTED, fontFamily: F.m, fontSize: 11, marginTop: 6 }}>querying on-chain security feeds…</Text>
    </Glass>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({ Orbitron_700Bold, Orbitron_900Black, SpaceGrotesk_400Regular, SpaceGrotesk_600SemiBold, JetBrainsMono_400Regular, JetBrainsMono_600SemiBold });
  const [api, setApi] = useState(DEFAULT_API);
  const [addr, setAddr] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => { (async () => {
    const h = await AsyncStorage.getItem('history'); if (h) setHistory(JSON.parse(h));
    const a = await AsyncStorage.getItem('api'); if (a) setApi(a);
  })(); }, []);

  async function check(a = addr) {
    const address = a.trim(); if (!address) return;
    setLoading(true); setErr('');
    try {
      const res = await fetch(`${api.replace(/\/$/, '')}/api/check?address=${encodeURIComponent(address)}`);
      const r: Result = await res.json();
      if (r.error) throw new Error(r.error);
      setResult(r);
      const item: HistoryItem = { address, name: r.extra?.symbol || r.market?.symbol || address.slice(0, 6), score: r.score, verdict: r.verdict, chain: r.chain, at: Date.now() };
      const h = [item, ...history.filter(x => x.address !== address)].slice(0, 20);
      setHistory(h); AsyncStorage.setItem('history', JSON.stringify(h));
    } catch (e: any) { setErr(e?.message || 'Request failed — is the API URL reachable?'); }
    setLoading(false);
  }

  if (!fontsLoaded) return <Background><View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={CYAN} /></View></Background>;

  if (result) {
    const color = COLORS[result.verdict] || CYAN, m = result.market;
    return (
      <Background><SafeAreaView style={{ flex: 1 }}><StatusBar style="light" />
        <ScrollView contentContainerStyle={s.pad}>
          <Pressable onPress={() => setResult(null)}><Text style={s.link}>‹ NEW SCAN</Text></Pressable>
          <Glass style={{ alignItems: 'center', marginTop: 14 }} accent={color}>
            <Text style={s.tname}>{result.extra?.name || m?.name || 'Unknown token'} {m?.symbol ? <Text style={{ color: MUTED }}>${m.symbol}</Text> : null}</Text>
            <Text style={s.addr}>{result.chain} :: {result.address}</Text>
            <Gauge score={result.score} color={color} />
            <View style={[s.badge, { borderColor: color, backgroundColor: color + '1f', shadowColor: color }]}>
              <Text style={[{ color, fontFamily: F.h, letterSpacing: 3, fontSize: 15 }, glow(color, 8)]}>{result.verdict.toUpperCase()}</Text>
            </View>
          </Glass>
          <Glass style={{ marginTop: 14 }}>
            <Text style={s.lbl}>MARKET TELEMETRY</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[['LIQUIDITY', compact(m?.liquidityUsd)], ['24H VOL', compact(m?.volume24h)], ['AGE', m?.ageDays == null ? 'n/a' : `${m.ageDays.toFixed(0)}d`]].map(([k, v]) => (
                <View key={k} style={s.stat}><Text style={s.statK}>{k}</Text><Text style={s.statV} numberOfLines={1} adjustsFontSizeToFit>{v}</Text></View>))}
            </View>
            {m?.url ? <Pressable onPress={() => Linking.openURL(m.url)}><Text style={[s.link, { marginTop: 12, fontFamily: F.m }]}>↗ open on DexScreener</Text></Pressable> : null}
          </Glass>
          <Glass style={{ marginTop: 14 }} accent="#ff3b5c">
            <Text style={[s.lbl, { color: '#ff3b5c' }]}>⚠ RED FLAGS · {result.flags.length}</Text>
            {result.flags.length ? result.flags.map((f, i) => <Item key={i} text={f} bad />) : <Text style={s.t}>None found</Text>}
          </Glass>
          <Glass style={{ marginTop: 14 }} accent="#00ffa3">
            <Text style={[s.lbl, { color: '#00ffa3' }]}>✓ GOOD SIGNS · {result.good.length}</Text>
            {result.good.length ? result.good.map((f, i) => <Item key={i} text={f} />) : <Text style={s.t}>None</Text>}
          </Glass>
          <Text style={s.disclaimer}>⚠ Not financial advice. Automated heuristic check — always DYOR.</Text>
          <Text style={s.foot}>SOURCES :: {Object.entries(result.sources).map(([k, v]) => `${k}=${v}`).join(' · ')}</Text>
        </ScrollView>
      </SafeAreaView></Background>
    );
  }

  return (
    <Background><SafeAreaView style={{ flex: 1 }}><StatusBar style="light" />
      <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
        <Text style={[s.brand, glow(CYAN, 16)]}>RUG<Text style={{ color: MAG }}>CHECK</Text></Text>
        <Text style={s.tag}><Text style={{ color: CYAN }}>// </Text>MEMECOIN THREAT SCANNER · SOL · ETH · BASE · BSC</Text>
        <Glass style={{ marginTop: 18 }}>
          <Text style={s.lbl}>TARGET CONTRACT</Text>
          <TextInput style={s.input} value={addr} onChangeText={setAddr} placeholder="Paste token address…" placeholderTextColor="#4b5872" autoCapitalize="none" autoCorrect={false} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable style={s.ghostBtn} onPress={async () => setAddr((await Clipboard.getStringAsync()).trim())}><Text style={s.ghostT}>PASTE</Text></Pressable>
            <Pressable style={{ flex: 1 }} onPress={() => check()} disabled={loading}>
              <LinearGradient colors={[CYAN, MAG]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[s.btn, loading && { opacity: 0.6 }]}><Text style={s.btnT}>SCAN</Text></LinearGradient>
            </Pressable>
          </View>
          {err ? <Text style={{ color: '#ff3b5c', marginTop: 10, fontFamily: F.b }}>{err}</Text> : null}
        </Glass>
        {loading ? <Scanning /> : null}
        <Text style={[s.lbl, { marginTop: 26 }]}>RECENT SCANS</Text>
        {history.length === 0 ? <Text style={s.foot}>No scans yet.</Text> : history.map(h => (
          <Pressable key={h.address} style={s.row} onPress={() => { setAddr(h.address); check(h.address); }}>
            <View style={[s.dot, { backgroundColor: COLORS[h.verdict], shadowColor: COLORS[h.verdict] }]} />
            <View style={{ flex: 1 }}><Text style={s.rowT}>{h.name} <Text style={{ color: MUTED, fontFamily: F.m, fontSize: 11 }}>{h.chain}</Text></Text><Text style={s.addr} numberOfLines={1}>{h.address}</Text></View>
            <View style={{ alignItems: 'flex-end' }}><Text style={{ color: COLORS[h.verdict], fontFamily: F.hb, fontSize: 18 }}>{h.score}</Text><Text style={{ color: COLORS[h.verdict], fontFamily: F.m, fontSize: 10 }}>{h.verdict}</Text></View>
          </Pressable>))}
        {history.length ? <Pressable onPress={() => { setHistory([]); AsyncStorage.removeItem('history'); }}><Text style={[s.link, { marginTop: 10, fontSize: 12 }]}>CLEAR HISTORY</Text></Pressable> : null}
        <Pressable onPress={() => setShowSettings(!showSettings)}><Text style={[s.link, { marginTop: 24, fontSize: 12 }]}>⚙ API SERVER</Text></Pressable>
        {showSettings ? <TextInput style={s.input} value={api} autoCapitalize="none" autoCorrect={false} onChangeText={v => { setApi(v); AsyncStorage.setItem('api', v); }} /> : null}
        <Text style={s.disclaimer}>⚠ Not financial advice.</Text>
      </ScrollView>
    </SafeAreaView></Background>
  );
}

function Item({ text, bad }: { text: string; bad?: boolean }) {
  const c = bad ? '#ff3b5c' : '#00ffa3';
  return (
    <View style={s.item}>
      <View style={[s.ic, { backgroundColor: c + '22', shadowColor: c }]}><Text style={{ color: c, fontFamily: F.ms, fontSize: 12 }}>{bad ? '!' : '✓'}</Text></View>
      <Text style={[s.t, { flex: 1 }]}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  pad: { padding: 18, paddingBottom: 60, maxWidth: 720, width: '100%', alignSelf: 'center' },
  brand: { color: CYAN, fontSize: 38, fontFamily: F.hb, letterSpacing: 4, marginTop: 10 },
  tag: { color: MUTED, fontFamily: F.m, fontSize: 10, letterSpacing: 1.5, marginTop: 6 },
  glass: { backgroundColor: 'rgba(16,22,36,0.6)', borderColor: LINE, borderWidth: 1, borderRadius: 18, padding: 16, overflow: 'hidden', ...(Platform.OS === 'web' ? ({ backdropFilter: 'blur(14px)' } as any) : {}) },
  glassAccent: { position: 'absolute', top: 0, left: 18, width: 70, height: 2, borderRadius: 2 },
  lbl: { color: CYAN, fontFamily: F.h, fontSize: 11, letterSpacing: 3, marginBottom: 10 },
  input: { backgroundColor: 'rgba(0,0,0,0.45)', color: '#e8f6ff', borderRadius: 12, padding: 14, fontSize: 14, fontFamily: F.m, marginBottom: 12, borderWidth: 1, borderColor: LINE },
  btn: { padding: 15, borderRadius: 12, alignItems: 'center', shadowColor: CYAN, shadowOpacity: 0.6, shadowRadius: 14, shadowOffset: { width: 0, height: 0 } },
  btnT: { color: '#05060a', fontFamily: F.hb, letterSpacing: 4, fontSize: 15 },
  ghostBtn: { borderWidth: 1, borderColor: CYAN, borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center', backgroundColor: 'rgba(0,240,255,0.08)' },
  ghostT: { color: CYAN, fontFamily: F.h, letterSpacing: 2, fontSize: 12 },
  tname: { color: '#e8f6ff', fontFamily: F.h, fontSize: 20, letterSpacing: 1, textAlign: 'center' },
  addr: { color: MUTED, fontFamily: F.m, fontSize: 10, marginTop: 4, textAlign: 'center' },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 9, shadowOpacity: 0.7, shadowRadius: 14, shadowOffset: { width: 0, height: 0 } },
  stat: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', borderColor: LINE, borderWidth: 1, borderRadius: 12, padding: 10 },
  statK: { color: MUTED, fontFamily: F.h, fontSize: 9, letterSpacing: 1.5 }, statV: { color: '#e8f6ff', fontFamily: F.ms, fontSize: 14, marginTop: 6 },
  item: { flexDirection: 'row', gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' },
  ic: { width: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center', shadowOpacity: 0.6, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  t: { color: '#d6e4f5', fontFamily: F.b, fontSize: 14, lineHeight: 20 },
  link: { color: CYAN, fontFamily: F.h, letterSpacing: 2, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(16,22,36,0.6)', borderColor: LINE, borderWidth: 1, padding: 12, borderRadius: 14, marginTop: 8, gap: 10 },
  rowT: { color: '#e8f6ff', fontFamily: F.bs, fontSize: 15 },
  dot: { width: 8, height: 8, borderRadius: 4, shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  disclaimer: { color: '#ffd23f', fontFamily: F.b, marginTop: 20, marginBottom: 6, fontSize: 13 },
  foot: { color: MUTED, fontFamily: F.m, fontSize: 10 },
});
