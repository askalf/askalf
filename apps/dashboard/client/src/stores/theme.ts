import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'dark' | 'light' | 'system';
type FontSize = 'small' | 'medium' | 'large';
type FontFamily = 'inter' | 'system' | 'mono';

interface ThemeState {
  theme: Theme;
  fontSize: FontSize;
  fontFamily: FontFamily;
  reducedMotion: boolean;
  setTheme: (theme: Theme) => void;
  setFontSize: (size: FontSize) => void;
  setFontFamily: (family: FontFamily) => void;
  setReducedMotion: (reduced: boolean) => void;
  applyTheme: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      fontSize: 'medium',
      fontFamily: 'system',
      reducedMotion: false,

      setTheme: (theme) => {
        set({ theme });
        get().applyTheme();
      },

      setFontSize: (fontSize) => {
        set({ fontSize });
        get().applyTheme();
      },

      setFontFamily: (fontFamily) => {
        set({ fontFamily });
        get().applyTheme();
      },

      setReducedMotion: (reducedMotion) => {
        set({ reducedMotion });
        get().applyTheme();
      },

      applyTheme: () => {
        const { theme, fontSize, fontFamily, reducedMotion } = get();
        const root = document.documentElement;

        // Apply user preferences on dashboard routes (command-center, settings, users, etc.)
        // Public pages (landing, login, about, etc.) use defaults
        const publicPaths = ['/', '/login', '/signup', '/register', '/forgot-password', '/reset-password', '/verify-email', '/privacy', '/terms', '/about'];
        const isDashboard = !publicPaths.includes(window.location.pathname);

        // Determine actual theme (handle 'system')
        let actualTheme: string = isDashboard ? theme : 'dark';
        if (actualTheme === 'system') {
          actualTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }

        root.setAttribute('data-theme', actualTheme);
        root.setAttribute('data-font-size', isDashboard ? fontSize : 'medium');
        root.setAttribute('data-font-family', isDashboard ? fontFamily : 'system');

        if (isDashboard && reducedMotion) {
          root.classList.add('reduced-motion');
        } else {
          root.classList.remove('reduced-motion');
        }
      },
    }),
    {
      name: 'askalf-theme',
    }
  )
);

// Initialize theme on load
if (typeof window !== 'undefined') {
  setTimeout(() => {
    useThemeStore.getState().applyTheme();
  }, 0);
}
