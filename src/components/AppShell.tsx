import React, { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
  BookOpen,
  Compass,
  Search,
  SlidersHorizontal,
  LogOut,
  Mic,
  Globe,
  Menu,
  X,
} from "lucide-react";
import { BRAND } from "../config/brand";
import { UI_LOCALES } from "../shared/languages";
import { useAuth } from "../client/AuthContext";
import { changeInterfaceLanguage } from "../i18n";
import { BrandLogoMark, BrandFooter } from "./BrandLogo";

export function AppShell({
  children,
  onOpenNewMeeting,
}: {
  children: React.ReactNode;
  onOpenNewMeeting: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { user, signOut, updatePreferences } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const shouldReduceMotion = useReducedMotion();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    { to: "/", icon: Compass, label: t("nav.dashboard"), end: true },
    { to: "/meetings", icon: BookOpen, label: t("nav.meetings"), end: false },
    { to: "/search", icon: Search, label: t("nav.search"), end: false },
    { to: "/settings", icon: SlidersHorizontal, label: t("nav.settings"), end: false },
  ];

  const handleUiLocaleChange = async (newLang: string) => {
    await changeInterfaceLanguage(newLang);
    if (user) {
      try {
        await updatePreferences({ uiLanguage: newLang });
      } catch {
        // local change already applied
      }
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  const currentUiLang = (i18n.language || "en").split("-")[0];

  const isRouteActive = (to: string, end: boolean) => {
    if (end) return location.pathname === to;
    return location.pathname.startsWith(to);
  };

  return (
    <div className="min-h-screen flex flex-col memoir-paper-surface text-[#101626] dark:text-[#F4F3EF]">
      {/* Floating Editorial Studio Bar */}
      <header className="sticky top-0 z-40 px-4 pt-4 pb-2 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#101626]/10 bg-white/85 px-4 py-2.5 shadow-[0_8px_30px_rgb(16,22,38,0.05)] backdrop-blur-xl dark:border-white/10 dark:bg-[#13192B]/85">
            {/* Brand Identity */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Open navigation menu"
                className="md:hidden rounded-xl p-1.5 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/10"
              >
                <Menu className="h-5 w-5" />
              </button>

              <NavLink to="/" className="flex items-center gap-2.5 group">
                <BrandLogoMark className="h-9 w-9" />
                <div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-serif-editorial italic text-2xl tracking-tight leading-none text-[#101626] dark:text-white">
                      {BRAND.wordmark}
                    </span>
                    <span className="hidden xl:inline-block h-1.5 w-1.5 rounded-full bg-[#22D3EE]" />
                  </div>
                  <div className="hidden sm:block text-[10px] tracking-wide uppercase font-medium text-zinc-400">
                    {BRAND.slogan}
                  </div>
                </div>
              </NavLink>
            </div>

            {/* Center Magnetic Pill Navigation */}
            <nav className="hidden md:flex items-center gap-1 rounded-full bg-[#F7F6F2] p-1 border border-[#101626]/8 dark:bg-[#0B0F1A] dark:border-white/10">
              {navItems.map((item) => {
                const active = isRouteActive(item.to, item.end);
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={`relative flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                      active
                        ? "text-white"
                        : "text-zinc-600 hover:text-[#101626] dark:text-zinc-400 dark:hover:text-white"
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="memoir-nav-pill"
                        className="absolute inset-0 rounded-full bg-[#101626] shadow-xs dark:bg-[#5B5BF0]"
                        transition={
                          shouldReduceMotion
                            ? { duration: 0 }
                            : { type: "spring", stiffness: 420, damping: 32 }
                        }
                      />
                    )}
                    <item.icon className="relative z-10 h-3.5 w-3.5 shrink-0" />
                    <span className="relative z-10">{item.label}</span>
                  </NavLink>
                );
              })}
            </nav>

            {/* Right Controls: Language Pill, Primary Capture Button, User */}
            <div className="flex items-center gap-2.5">
              {/* Compact Locale Selector */}
              <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-[#101626]/10 bg-[#F7F6F2] px-2.5 py-1.5 dark:border-white/10 dark:bg-[#0B0F1A]">
                <Globe className="h-3.5 w-3.5 text-[#5B5BF0] dark:text-[#22D3EE] shrink-0" />
                <select
                  aria-label={t("nav.interfaceLanguage")}
                  value={currentUiLang}
                  onChange={(e) => handleUiLocaleChange(e.target.value)}
                  className="bg-transparent text-xs font-semibold text-[#101626] focus:outline-none cursor-pointer dark:text-zinc-200"
                >
                  {UI_LOCALES.map((loc) => (
                    <option
                      key={loc.tag}
                      value={loc.tag}
                      className="bg-white text-[#101626] dark:bg-[#101626] dark:text-white"
                    >
                      {loc.nativeName} ({loc.tag.toUpperCase()})
                    </option>
                  ))}
                </select>
              </div>

              {/* Primary Record / Capture Action */}
              <motion.button
                type="button"
                whileHover={shouldReduceMotion ? undefined : { scale: 1.03, y: -1 }}
                whileTap={shouldReduceMotion ? undefined : { scale: 0.97 }}
                onClick={onOpenNewMeeting}
                className="group relative inline-flex items-center gap-2 rounded-full bg-[#101626] px-4 py-2 text-xs font-semibold text-white shadow-[0_6px_20px_rgba(91,91,240,0.28)] hover:bg-[#5B5BF0] transition-colors cursor-pointer dark:bg-[#5B5BF0] dark:hover:bg-[#4A4AE0]"
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#22D3EE] opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#22D3EE]" />
                </span>
                <Mic className="h-3.5 w-3.5" />
                <span>{t("app.newMeeting")}</span>
              </motion.button>

              {user && (
                <div className="hidden lg:flex items-center gap-2 pl-2 border-l border-[#101626]/10 dark:border-white/10">
                  <div className="text-right">
                    <div className="text-xs font-semibold leading-tight text-[#101626] dark:text-white max-w-[115px] truncate">
                      {user.displayName}
                    </div>
                    <div className="text-[10px] text-zinc-400 max-w-[115px] truncate">
                      {user.email || "Apple ID"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    title={t("nav.signOut")}
                    aria-label={t("nav.signOut")}
                    className="rounded-full p-2 text-zinc-400 hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer dark:hover:bg-red-950/40"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Slide-Over Sheet */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 md:hidden flex">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-[#101626]/50 backdrop-blur-xs"
              onClick={() => setMobileMenuOpen(false)}
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: "spring", stiffness: 380, damping: 34 }}
              className="relative z-10 flex w-72 flex-col justify-between bg-[#F7F6F2] p-5 border-r border-[#101626]/10 dark:bg-[#101626] dark:border-white/10"
            >
              <div>
                <div className="flex items-center justify-between pb-4 border-b border-[#101626]/10 dark:border-white/10">
                  <div className="flex items-center gap-2.5">
                    <BrandLogoMark className="h-8 w-8" />
                    <span className="font-serif-editorial italic text-2xl">
                      {BRAND.wordmark}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMobileMenuOpen(false)}
                    aria-label="Close navigation menu"
                    className="rounded-full p-1.5 text-zinc-500 hover:bg-black/5"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <nav className="mt-5 space-y-1.5">
                  {navItems.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      onClick={() => setMobileMenuOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors ${
                          isActive
                            ? "bg-[#101626] text-white dark:bg-[#5B5BF0]"
                            : "text-zinc-600 hover:bg-black/5 dark:text-zinc-300"
                        }`
                      }
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span>{item.label}</span>
                    </NavLink>
                  ))}
                </nav>
              </div>

              <div className="space-y-4 border-t border-[#101626]/10 pt-4 dark:border-white/10">
                <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 border border-[#101626]/10 dark:bg-[#0B0F1A] dark:border-white/10">
                  <Globe className="h-4 w-4 text-[#5B5BF0]" />
                  <select
                    aria-label={t("nav.interfaceLanguage")}
                    value={currentUiLang}
                    onChange={(e) => handleUiLocaleChange(e.target.value)}
                    className="w-full bg-transparent text-xs font-semibold focus:outline-none"
                  >
                    {UI_LOCALES.map((loc) => (
                      <option key={loc.tag} value={loc.tag}>
                        {loc.nativeName} ({loc.tag.toUpperCase()})
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={handleSignOut}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                >
                  <LogOut className="h-4 w-4" />
                  <span>{t("nav.signOut")}</span>
                </button>
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* Main Editorial Workspace Canvas */}
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>

      {/* Editorial Footer */}
      <footer className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 border-t border-[#101626]/8 dark:border-white/10 mt-12">
        <BrandFooter />
      </footer>
    </div>
  );
}
