import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, Image, StyleSheet } from 'react-native';

const REGIONS = ['US', 'GB', 'DE', 'FR', 'JP', 'PL', 'TR', 'AU', 'CA', 'IE', 'SE', 'ZA', 'IT', 'ES'];

const C = {
  bg: '#0E1014',
  panel: '#171A21',
  panelHi: '#1E222B',
  border: '#2B313C',
  text: '#E7EAF0',
  muted: '#99A1B0',
  accent: '#3B74F2',
  good: '#2FBF87',
  bad: '#E5484D',
};

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

export default function App() {
  const [region, setRegion] = useState('US');
  const [value, setValue] = useState('');
  const [card, setCard] = useState(null);
  const [message, setMessage] = useState(null);
  const [messageKind, setMessageKind] = useState('info');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const resize = useCallback((height) => {
    if (window.api && height > 0) window.api.resize(height);
  }, []);

  const run = useCallback(async (raw, reg) => {
    if (!raw || !String(raw).trim()) return;
    setLoading(true);
    setCard(null);
    setCopied(false);
    setMessage('Querying the PlayStation catalog…');
    setMessageKind('info');
    try {
      const res = await window.api.resolve(raw, reg);
      if (res.ok) {
        setCard(res.card);
        if (res.note) {
          setMessage(res.note);
          setMessageKind('info');
        } else {
          setMessage(null);
        }
      } else {
        setCard(null);
        setMessage(res.message);
        setMessageKind('error');
      }
    } catch (err) {
      setCard(null);
      setMessage(String((err && err.message) || err));
      setMessageKind('error');
    } finally {
      setLoading(false);
    }
  }, []);

  const pickRegion = useCallback(
    (code) => {
      if (code === region) return;
      setRegion(code);
      setCard(null);
      setMessage(null);
      if (value.trim()) run(value, code);
    },
    [region, value, run]
  );

  const paste = useCallback(async () => {
    if (!window.api) return;
    const text = await window.api.paste();
    if (text) setValue(String(text).trim());
  }, []);

  const openEdat = useCallback(async () => {
    if (!window.api) return;
    const res = await window.api.pickEdat();
    if (!res) return;
    if (!res.ok) {
      setMessage(res.message);
      setMessageKind('error');
      return;
    }
    setValue(res.sku);
    run(res.sku, region);
  }, [region, run]);

  const copyLink = useCallback(async () => {
    if (!card) return;
    await window.api.copy(card.link);
    setCopied(true);
  }, [card]);

  // Snapshot mode, used for automated layout checks.
  useEffect(() => {
    const snap = new URLSearchParams(window.location.search).get('snap');
    if (!snap || !window.api) return;
    (async () => {
      if (snap === 'error') {
        setMessage(
          'Not sold in US. Sony returns DataNotFound for this SKU there — delisted, or a different catalog. Try another region.'
        );
        setMessageKind('error');
      } else if (snap === 'sweep') {
        setValue('0300F206172D2DE79C5479547C7B13DF6CD0E693');
        await run('0300F206172D2DE79C5479547C7B13DF6CD0E693', 'US');
      } else if (snap === 'gb') {
        setRegion('GB');
        setValue('B19E79472B5D7F475C9FEAFC93FF7F2A6C4DEDAB');
        await run('B19E79472B5D7F475C9FEAFC93FF7F2A6C4DEDAB', 'GB');
      } else if (snap === 'twin') {
        setValue('0313AC7E86C07FD76067E4D7276852B3819350F7');
        await run('0313AC7E86C07FD76067E4D7276852B3819350F7', 'US');
      } else if (snap !== 'empty') {
        setValue('UP1004-BLUS30418_00-AVARDRSHADOWWOLF');
        await run('UP1004-BLUS30418_00-AVARDRSHADOWWOLF', 'US');
      }
      await new Promise((r) => setTimeout(r, 900));
      await window.api.snapshotReady();
    })();
  }, [run]);

  return (
    <View
      style={styles.app}
      onLayout={(e) => resize(e.nativeEvent.layout.height)}
    >
      <View>
        <Text style={styles.h1}>PSN Avatar → Cart</Text>
        <Text style={styles.sub}>PSNA hash or SKU → live catalog lookup → checkout link</Text>
      </View>

      <View style={styles.chips}>
        {REGIONS.map((code) => {
          const active = code === region;
          return (
            <Pressable
              key={code}
              onPress={() => pickRegion(code)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{code}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.row}>
        <View style={styles.field}>
          <TextInput
            value={value}
            onChangeText={setValue}
            onSubmitEditing={() => run(value, region)}
            placeholder="Paste a PSNA hash or SKU…"
            placeholderTextColor={C.muted}
            style={styles.input}
            autoCapitalize="characters"
            autoCorrect={false}
            spellCheck={false}
          />
        </View>
        <Pressable style={styles.ghost} onPress={paste}>
          <Text style={styles.ghostText}>Paste</Text>
        </Pressable>
        <Pressable style={styles.ghost} onPress={openEdat}>
          <Text style={styles.ghostText}>Open .edat…</Text>
        </Pressable>
        <Pressable
          style={[styles.primary, loading && styles.dim]}
          onPress={() => run(value, region)}
          disabled={loading}
        >
          <Text style={styles.primaryText}>Resolve</Text>
        </Pressable>
      </View>

      {message ? (
        <View
          style={[
            styles.message,
            messageKind === 'error' ? styles.messageError : styles.messageInfo,
          ]}
        >
          <Text
            style={[
              styles.messageText,
              messageKind === 'error' ? styles.messageTextError : styles.messageTextInfo,
            ]}
          >
            {message}
          </Text>
        </View>
      ) : null}

      {card ? (
        <View style={styles.card}>
          <View style={styles.top}>
            {card.image ? (
              <Image source={{ uri: card.image }} style={styles.thumb} resizeMode="cover" />
            ) : (
              <View style={styles.thumb} />
            )}
            <View style={styles.meta}>
              <Text style={styles.name}>{card.name}</Text>
              <Text style={styles.line}>
                {card.platform} · {card.region}
              </Text>
              <Text style={[styles.price, card.price === 'Free' && styles.priceFree]}>
                {card.price}
              </Text>
              <Text style={styles.sku}>{card.baseSku}</Text>
              <Text style={styles.source}>
                {card.game ? `${card.game} · ${card.source}` : card.source}
              </Text>
            </View>
          </View>

          <View style={styles.actions}>
            <Pressable style={styles.smallPrimary} onPress={() => window.api.open(card.link)}>
              <Text style={styles.primaryText}>Add to cart ↗</Text>
            </Pressable>
            <Pressable style={styles.smallGhost} onPress={copyLink}>
              <Text style={styles.ghostText}>{copied ? 'Copied ✓' : 'Copy link'}</Text>
            </Pressable>
            <Text style={styles.hint}>
              Opens in your default browser with your existing store session.
            </Text>
          </View>
        </View>
      ) : (
        <View style={[styles.card, styles.cardEmpty]}>
          <View style={styles.emptyInner}>
            <Text style={styles.emptyTitle}>No item resolved yet</Text>
            <Text style={styles.emptyBody}>
              Pick a region, paste a PSNA hash or SKU, then hit Resolve.{'\n'}
              Artwork, price and a ready-to-use cart link appear here.
            </Text>
          </View>
        </View>
      )}

      <Text style={styles.footer}>
        Nothing is purchased here — the link only puts the item in your cart; you confirm and pay on
        PlayStation's own checkout page.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  app: {
    padding: 22,
    gap: 14,
    backgroundColor: C.bg,
  },
  h1: { fontSize: 22, fontWeight: '700', color: C.text, letterSpacing: -0.2 },
  sub: { fontSize: 11, color: C.muted, marginTop: 3 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.panel,
  },
  chipActive: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { fontSize: 11, fontWeight: '500', color: C.muted },
  chipTextActive: { color: '#fff' },

  row: { flexDirection: 'row', gap: 8 },
  field: {
    flex: 1,
    height: 40,
    justifyContent: 'center',
    paddingHorizontal: 10,
    backgroundColor: C.panel,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 7,
  },
  input: {
    fontSize: 12,
    color: C.text,
    fontFamily: MONO,
    outlineStyle: 'none',
    borderWidth: 0,
    backgroundColor: 'transparent',
  },

  primary: {
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 7,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontSize: 12, fontWeight: '500', color: '#fff' },
  ghost: {
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 7,
    backgroundColor: C.panelHi,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostText: { fontSize: 12, fontWeight: '500', color: C.text },
  dim: { opacity: 0.55 },

  message: { paddingVertical: 9, paddingHorizontal: 11, borderRadius: 8, borderWidth: 1 },
  messageInfo: { backgroundColor: C.panel, borderColor: C.border },
  messageError: { backgroundColor: 'rgba(229,72,77,0.10)', borderColor: 'rgba(229,72,77,0.45)' },
  messageText: { fontSize: 11.5, lineHeight: 17 },
  messageTextInfo: { color: C.muted },
  messageTextError: { color: C.bad },

  card: {
    padding: 14,
    gap: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.panel,
  },
  cardEmpty: { minHeight: 124, justifyContent: 'center', backgroundColor: 'rgba(23,26,33,0.55)' },
  emptyInner: { padding: 16, gap: 4 },
  emptyTitle: { fontSize: 13, fontWeight: '600', color: C.muted },
  emptyBody: { fontSize: 11, lineHeight: 17, color: C.muted },

  top: { flexDirection: 'row', gap: 14 },
  thumb: { width: 128, height: 128, borderRadius: 8, backgroundColor: C.panelHi },
  meta: { flex: 1, gap: 4, minWidth: 0 },
  name: { fontSize: 16, fontWeight: '700', color: C.text, lineHeight: 21 },
  line: { fontSize: 11, color: C.muted },
  price: { fontSize: 14, fontWeight: '600', color: C.text },
  priceFree: { color: C.good },
  sku: { fontSize: 10, color: C.muted, fontFamily: MONO },
  source: { fontSize: 10, color: C.muted },

  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  smallPrimary: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 7,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallGhost: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 7,
    backgroundColor: C.panelHi,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: { fontSize: 10, color: C.muted, flexShrink: 1 },

  footer: { fontSize: 10, lineHeight: 15, color: C.muted },
});
