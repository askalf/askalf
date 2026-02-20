import { Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import Home from './pages/Home';
import BranchDetail from './pages/BranchDetail';

export default function App() {
  return (
    <div className="jp-app">
      <Header />
      <main className="jp-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/branch/:name" element={<BranchDetail />} />
        </Routes>
      </main>
    </div>
  );
}
