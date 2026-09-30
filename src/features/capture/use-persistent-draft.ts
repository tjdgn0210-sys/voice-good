import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { CaptureDraft } from '../../domain/draft/draft';
import { useExpenses } from './expense-context';
export function usePersistentDraft(slot: string, initialFields: Record<string, string>) {
  const services = useExpenses();
  const [initial] = useState(initialFields);
  const fresh = useCallback((): CaptureDraft => ({ actionId: services.newActionId(), capturedAt: services.now(), inputMethod: 'MANUAL', fields: { ...initial } }), [services, initial]);
  const [draft, setDraft] = useState(fresh);
  const current = useRef(draft);
  const [ready, setReady] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const dirty = useRef(false);
  const mounted = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persist = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current) return;
    const snapshot = current.current;
    try {
      await services.drafts.save(slot, snapshot);
      if (current.current === snapshot) { dirty.current = false; if (mounted.current) setStatus('saved'); }
    } catch (error) { if (mounted.current) setStatus('error'); throw error; }
  }, [services, slot]);
  useEffect(() => {
    mounted.current = true;
    services.drafts.read(slot).then(saved => {
      if (!mounted.current) return;
      if (saved) { current.current = saved; setDraft(saved); setStatus('saved'); }
      setReady(true);
    }).catch(() => { if (mounted.current) setStatus('error'); });
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') void persist().catch(() => {}); });
    return () => { mounted.current = false; subscription.remove(); void persist().catch(() => {}); };
  }, [services, slot, persist, loadAttempt]);
  function replace(value: CaptureDraft) {
    current.current = value; setDraft(value); dirty.current = true; setStatus('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void persist().catch(() => {}); }, 350);
  }
  function update(fields: Record<string, string>, method: CaptureDraft['inputMethod'] = current.current.inputMethod) {
    replace({ ...fresh(), fields, inputMethod: method });
  }
  async function clear() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    await services.drafts.remove(slot);
    dirty.current = false;
    const next = fresh(); current.current = next; setDraft(next); setStatus('idle'); setReady(true);
  }
  return { draft, ready, status, replace, update, persist, clear, retry: () => { if (ready) return persist(); setLoadAttempt(value => value + 1); return Promise.resolve(); } };
}
