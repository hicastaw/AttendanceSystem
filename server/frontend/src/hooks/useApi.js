import { useCallback, useEffect, useRef, useState } from 'react';

// Tải dữ liệu từ API: { data, loading, error, reload }. `deps` đổi thì tải lại;
// `intervalMs` để tự làm mới (vd ai đang ở lab). Lần làm mới nền không bật lại loading,
// tránh Skeleton nhấp nháy.
export default function useApi(fetcher, deps = [], { intervalMs } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    try {
      const result = await fetcherRef.current();
      setData(result);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    if (!intervalMs) return undefined;
    const id = setInterval(() => load(true), intervalMs);
    return () => clearInterval(id);
  }, [load, intervalMs, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading, error, reload: load };
}
