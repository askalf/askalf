import { createContext, useContext, useState, ReactNode } from 'react';
import BugReportModal from '../components/BugReportModal';

interface BugReportContextType {
  openBugReport: () => void;
}

const BugReportContext = createContext<BugReportContextType | null>(null);

export function BugReportProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <BugReportContext.Provider value={{ openBugReport: () => setIsOpen(true) }}>
      {children}
      <BugReportModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </BugReportContext.Provider>
  );
}

export function useBugReport() {
  const context = useContext(BugReportContext);
  if (!context) {
    throw new Error('useBugReport must be used within a BugReportProvider');
  }
  return context;
}
