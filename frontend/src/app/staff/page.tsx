"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Staff & CSV Import now lives in Administration.
export default function StaffRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/config?tab=staff"); }, [router]);
  return null;
}
