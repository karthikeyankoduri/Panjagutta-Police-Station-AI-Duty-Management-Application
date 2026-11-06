"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DutyAllocationRedirect() {
  const router = useRouter();
  useEffect(() => {
    const qs = typeof window !== "undefined" ? window.location.search : "";
    let target = "/roster?tab=allocation";
    if (qs) {
      const params = new URLSearchParams(qs);
      params.set("tab", "allocation");
      target = `/roster?${params.toString()}`;
    }
    router.replace(target);
  }, [router]);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
      <div className="spinner" />
    </div>
  );
}
