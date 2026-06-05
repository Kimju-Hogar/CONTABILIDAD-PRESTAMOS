'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { BottomNav } from '@/components/layout/BottomNav';
import { TopBar } from '@/components/layout/TopBar';
import { OfflineBanner } from '@/components/shared/OfflineBanner';
import { useSocket } from '@/hooks/useSocket';
import { Loader2 } from 'lucide-react';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);

  // Esperar a que Zustand se hidrate en el cliente
  useEffect(() => {
    setHydrated(useAuthStore.persist.hasHydrated());
    const unsub = useAuthStore.persist.onFinishHydration(() => {
      setHydrated(true);
    });
    return () => unsub();
  }, []);

  // Proteger todas las rutas del dashboard una vez hidratado
  useEffect(() => {
    if (hydrated && !isAuthenticated) {
      router.replace('/login');
    }
  }, [hydrated, isAuthenticated, router]);

  // Activar Socket.IO globalmente
  useSocket();

  if (!hydrated) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)' }}>
        <Loader2 size={32} className="animate-pulse-soft" color="var(--brand-500)" style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  if (!isAuthenticated) return null;

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg-base)' }}>
      <TopBar />
      <OfflineBanner />
      <main className="main-content">
        <div style={{ padding: '16px', maxWidth: '430px', margin: '0 auto' }}>
          {children}
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
