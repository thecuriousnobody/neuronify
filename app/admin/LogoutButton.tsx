'use client';

import { useRouter } from 'next/navigation';
import styles from './admin.module.css';

export default function LogoutButton() {
  const router = useRouter();
  const logout = async () => {
    await fetch('/api/admin/login', { method: 'DELETE' });
    router.refresh();
  };
  return (
    <button className={styles.logout} onClick={logout}>
      Sign out
    </button>
  );
}
