'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home, Users, CreditCard, DollarSign, Wallet, BarChart3
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';

const NAV_COBRADOR = [
  { href: '/',          icon: Home,        label: 'Inicio' },
  { href: '/clientes',  icon: Users,       label: 'Clientes' },
  { href: '/cobros',    icon: DollarSign,  label: 'Cobros' },
  { href: '/prestamos', icon: CreditCard,  label: 'Préstamos' },
  { href: '/caja',      icon: Wallet,      label: 'Caja' },
];

// Admin y auditor cambian Clientes por el panel: las cifras pesan más que el listado
const NAV_ADMIN = [
  { href: '/',          icon: Home,        label: 'Inicio' },
  { href: '/cobros',    icon: DollarSign,  label: 'Cobros' },
  { href: '/prestamos', icon: CreditCard,  label: 'Préstamos' },
  { href: '/caja',      icon: Wallet,      label: 'Caja' },
  { href: '/admin',     icon: BarChart3,   label: 'Panel' },
];

export function BottomNav() {
  const pathname = usePathname();
  const { usuario } = useAuthStore();
  const mandaEnTodo = usuario?.rol === 'admin' || usuario?.rol === 'auditor';
  const navItems = mandaEnTodo ? NAV_ADMIN : NAV_COBRADOR;

  return (
    <nav className="bottom-nav" role="navigation" aria-label="Navegación principal">
      {navItems.map(({ href, icon: Icon, label }) => {
        const isActive = pathname === href || (href !== '/' && pathname.startsWith(href));
        return (
          <Link key={href} href={href} className={`nav-item ${isActive ? 'active' : ''}`}>
            <Icon
              size={22}
              strokeWidth={isActive ? 2.5 : 1.8}
              style={{ color: isActive ? 'var(--brand-500)' : 'var(--text-muted)' }}
            />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
