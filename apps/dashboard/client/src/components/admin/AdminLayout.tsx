import { Outlet } from 'react-router-dom';
import './AdminLayout.css';

export default function AdminLayout() {
  // Full-width layout — UnifiedDashboard handles its own chrome (TopBar, tabs)
  return (
    <div className="admin-layout admin-layout--full">
      <main className="admin-main admin-main--full">
        <Outlet />
      </main>
    </div>
  );
}
