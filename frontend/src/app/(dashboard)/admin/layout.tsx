'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';

/**
 * Todo lo que cuelga de /admin es solo para el rol administrador.
 * El backend también lo exige; esto evita que el cobrador vea pantallas vacías.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { usuario } = useAuthStore();
  const router = useRouter();
  // El auditor manda en todo, así que también entra al panel
  const esAdmin = usuario?.rol === 'admin' || usuario?.rol === 'auditor';

  useEffect(() => {
    if (usuario && !esAdmin) router.replace('/');
  }, [usuario, esAdmin, router]);

  if (!esAdmin) {
    return (
      <div className="empty-state">
        <ShieldAlert size={30} color="var(--text-muted)" />
        <p style={{ marginTop: 8, fontSize: 13.5 }}>
          Esta sección es solo para administradores.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
