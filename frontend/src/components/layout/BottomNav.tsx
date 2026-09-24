'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home, Users, CreditCard, DollarSign, Wallet, BarChart3
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';

const INICIO    = { href: '/',          icon: Home,       label: 'Inicio' };
const CLIENTES  = { href: '/clientes',  icon: Users,      label: 'Clientes' };
const COBROS    = { href: '/cobros',    icon: DollarSign, label: 'Cobros' };
const PRESTAMOS = { href: '/prestamos', icon: CreditCard, label: 'Préstamos' };
const CAJA      = { href: '/caja',      icon: Wallet,     label: 'Caja' };
const PANEL     = { href: '/admin',     icon: BarChart3,  label: 'Panel' };

// Clientes va en los tres roles; admin y auditor suman el panel
const NAV_COBRADOR = [INICIO, CLIENTES, COBROS, PRESTAMOS, CAJA];
const NAV_ADMIN    = [INICIO, CLIENTES, COBROS, PRESTAMOS, CAJA, PANEL];

export function BottomNav() {
  const pathname = usePathname();
  const { usuario } = useAuthStore();
  const mandaEnTodo = usuario?.rol === 'admin' || usuario?.rol === 'auditor';
  const navItems = mandaEnTodo ? NAV_ADMIN : NAV_COBRADOR;

  return (
    <nav
      className="bottom-nav"
      role="navigation"
      aria-label="Navegación principal"
      style={{ ['--nav-items' as string]: navItems.length }}
    >
      {navItems.map(({ href, icon: Icon, label }) => {
        const isActive = pathname === href || (href !== '/' && pathname.startsWith(href));
        return (
          <Link key={href} href={href} className={`nav-item ${isActive ? 'active' : ''}`}>
            <Icon
              size={21}
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
