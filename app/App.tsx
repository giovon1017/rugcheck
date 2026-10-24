import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View, Linking } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Circle } from 'react-native-svg';

// Backend URL: set EXPO_PUBLIC_API_URL, or change it in the app (Settings field). Must be publicly reachable for real phones.
const DEFAULT_API = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

type Market = { liquidityUsd: number; volume24h: number; ageDays: number | null; name: string; symbol: string; url: string } | null;
type Result = { address: string; chain: string; score: number; verdict: string; flags: string[]; good: string[]; market: Market; extra: { name?: string; symbol?: string } | null; disclaimer: string; sources: Record<string, string>; error?: string };
type HistoryItem = { address: string; name: string; score: number; verdict: string; chain: string; at: number };

const COLORS: Record<string, string> = { 'Likely Legit': '#2ecc71', Caution: '#f1c40f', 'High Risk': '#e67e22', 'Likely Scam': '#e74c3c' };
const usd = (n?: number) => (n == null ? 'n/a' : '$' + Math.round(n).toLocaleString('en-US'));

function Gauge({ score, color }: { score: number; color: string }) {
  const r = 60, c = 2 * Math.PI * r;
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={150} height={150}>
        <Circle cx={75} cy={75} r={r} stroke="#2a2f3a" strokeWidth={12} fill="none" />
        <Circle cx={75} cy={75} r={r} stroke={color} strokeWidth={12} fill="none" strokeDasharray={`${c}`} strokeDashoffset={c * (1 - score / 100)} strokeLinecap="round" rotation={-90} origin="75,75" />
      </Svg>
      <View style={StyleSheet.absoluteFill as any}><View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color, fontSize: 36, fontWeight: '800' }}>{score}</Text><Text style={s.muted}>risk / 100</Text>
      </View></View>
    </View>
  );
}

export default function App() {
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

  if (result) {
    const color = COLORS[result.verdict] || '#888', m = result.market;
    return (
      <SafeAreaView style={s.root}><StatusBar style="light" />
        <ScrollView contentContainerStyle={s.pad}>
          <Pressable onPress={() => setResult(null)}><Text style={s.link}>‹ Back</Text></Pressable>
          <Text style={s.title}>{result.extra?.name || m?.name || 'Token'} {m?.symbol ? `(${m.symbol})` : ''}</Text>
          <Text style={s.muted}>{result.chain} · {result.address}</Text>
          <View style={[s.card, { alignItems: 'center' }]}>
            <Gauge score={result.score} color={color} />
            <Text style={{ color, fontSize: 24, fontWeight: '700', marginTop: 8 }}>{result.verdict}</Text>
          </View>
          <View style={s.card}>
            <Text style={s.h}>Token info</Text>
            <Text style={s.t}>Liquidity: {usd(m?.liquidityUsd)}</Text>
            <Text style={s.t}>24h volume: {usd(m?.volume24h)}</Text>
            <Text style={s.t}>Age: {m?.ageDays == null ? 'n/a' : `${m.ageDays.toFixed(0)} days`}</Text>
            {m?.url ? <Pressable onPress={() => Linking.openURL(m.url)}><Text style={s.link}>View on DexScreener</Text></Pressable> : null}
          </View>
          <View style={s.card}><Text style={s.h}>🚩 Red flags</Text>
            {result.flags.length ? result.flags.map((f, i) => <Text key={i} style={s.t}>• {f}</Text>) : <Text style={s.t}>None found</Text>}</View>
          <View style={s.card}><Text style={s.h}>✅ Good signs</Text>
            {result.good.length ? result.good.map((f, i) => <Text key={i} style={s.t}>• {f}</Text>) : <Text style={s.t}>None</Text>}</View>
          <Text style={s.disclaimer}>⚠️ Not financial advice. Automated heuristic check — always DYOR.</Text>
          <Text style={s.muted}>Sources: {Object.entries(result.sources).map(([k, v]) => `${k}: ${v}`).join(' · ')}</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.root}><StatusBar style="light" />
      <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>🪙 Rug Checker</Text>
        <Text style={s.muted}>Paste a Solana mint or EVM (Ethereum / Base / BSC) contract address.</Text>
        <TextInput style={s.input} value={addr} onChangeText={setAddr} placeholder="Token address" placeholderTextColor="#666" autoCapitalize="none" autoCorrect={false} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable style={[s.btn, { backgroundColor: '#2a2f3a' }]} onPress={async () => setAddr((await Clipboard.getStringAsync()).trim())}><Text style={s.btnT}>📋 Paste</Text></Pressable>
          <Pressable style={[s.btn, { flex: 1 }]} onPress={() => check()} disabled={loading}>{loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnT}>Check token</Text>}</Pressable>
        </View>
        {err ? <Text style={{ color: '#e74c3c', marginTop: 10 }}>{err}</Text> : null}
        <Text style={[s.h, { marginTop: 24 }]}>Recent checks</Text>
        {history.length === 0 ? <Text style={s.muted}>No checks yet.</Text> : history.map(h => (
          <Pressable key={h.address} style={s.row} onPress={() => { setAddr(h.address); check(h.address); }}>
            <View style={{ flex: 1 }}><Text style={s.t}>{h.name} · {h.chain}</Text><Text style={s.muted} numberOfLines={1}>{h.address}</Text></View>
            <Text style={{ color: COLORS[h.verdict], fontWeight: '700' }}>{h.score} · {h.verdict}</Text>
          </Pressable>))}
        {history.length ? <Pressable onPress={() => { setHistory([]); AsyncStorage.removeItem('history'); }}><Text style={[s.link, { marginTop: 8 }]}>Clear history</Text></Pressable> : null}
        <Pressable onPress={() => setShowSettings(!showSettings)}><Text style={[s.link, { marginTop: 24 }]}>⚙️ API server</Text></Pressable>
        {showSettings ? <TextInput style={s.input} value={api} autoCapitalize="none" autoCorrect={false}
          onChangeText={v => { setApi(v); AsyncStorage.setItem('api', v); }} /> : null}
        <Text style={s.disclaimer}>⚠️ Not financial advice.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0e1117' }, pad: { padding: 20, paddingBottom: 60 },
  title: { color: '#fff', fontSize: 26, fontWeight: '800', marginVertical: 8 }, muted: { color: '#888', fontSize: 12 },
  input: { backgroundColor: '#161b22', color: '#eee', borderRadius: 10, padding: 14, fontSize: 15, marginVertical: 12, borderWidth: 1, borderColor: '#333' },
  btn: { backgroundColor: '#6c5ce7', padding: 14, borderRadius: 10, alignItems: 'center' }, btnT: { color: '#fff', fontWeight: '700' },
  card: { backgroundColor: '#161b22', borderRadius: 14, padding: 16, marginTop: 14 }, h: { color: '#fff', fontSize: 17, fontWeight: '700', marginBottom: 8 },
  t: { color: '#ddd', marginVertical: 3, lineHeight: 20 }, link: { color: '#9b8cff', fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#161b22', padding: 12, borderRadius: 10, marginTop: 8, gap: 8 },
  disclaimer: { color: '#f1c40f', marginTop: 20, marginBottom: 6 },
});
