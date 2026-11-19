"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { getLiveLocations, LiveLocation } from "@/lib/api";
import accessMatrix from "@/lib/access-matrix.json";

// Leaflet touches `window`, so it must only load in the browser.
const LiveMap = dynamic(() => import("@/components/LiveMap"), {
  ssr: false,
  loading: () => <div className="page-subtitle">Loading map…</div>,
});

const REFRESH_MS = 60_000;
export const LIVE_LOCATIONS_ID = "live-locations";
export const LIVE_LOCATIONS_ROLES = (accessMatrix.groups as Record<string, string[]>).ADMIN_ONLY;

/** Live officer map + officer list, shown on the Dashboard for the roles that may see locations. */
export default function LiveLocationsSection({ visible, onHide }: { visible: boolean; onHide: () => void }) {
  const { token, user } = useAuth();
  const allowed = Boolean(user && LIVE_LOCATIONS_ROLES.includes(user.role));
  const [locations, setLocations] = useState<LiveLocation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    if (!token || !allowed || !visible) return;
    try {
      setLocations(await getLiveLocations(token));
      setError(null);
      setRefreshedAt(new Date());
    } catch (err: any) {
      setError(err.message || "Failed to load live locations");
    } finally {
      setLoaded(true);
    }
  }, [token, allowed, visible]);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  if (!allowed || !visible) return null;

  return (
    <section id={LIVE_LOCATIONS_ID} aria-label="Live locations" style={{ marginTop: 28, scrollMarginTop: 16 }}>
      <div className="page-header">
        <div>
          <h2 className="page-title" style={{ fontSize: 22 }}>Live Locations</h2>
          <div className="page-subtitle">
            Latest GPS position reported by each officer&apos;s mobile app. Refreshes every minute
            {refreshedAt ? ` · last checked ${refreshedAt.toLocaleTimeString()}` : ""}.
          </div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={onHide}>Hide map</button>
      </div>
      {error && <div className="alert alert-danger" role="alert">{error}</div>}
      {loaded && !error && locations.length === 0 && (
        <div className="page-subtitle" style={{ marginBottom: 12 }}>
          No officer has reported a location yet. Positions appear once officers sign in on the mobile app and allow location access.
        </div>
      )}
      <LiveMap locations={locations} />
    </section>
  );
}
