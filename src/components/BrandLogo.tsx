import React from "react";
import { motion, useReducedMotion } from "motion/react";
import { BRAND } from "../config/brand";

/**
 * Memoir brand mark: Violet/Indigo gradient squircle featuring open memoir book pages
 * transitioning into animated audio waveform bars, using the Midnight navy (#101626),
 * Violet (#5B5BF0), and Soft cyan (#22D3EE) brand palette.
 */
export function BrandLogoMark({
  className = "h-8 w-8",
  animated = true,
}: {
  className?: string;
  variant?: "dark-badge" | "light-badge" | "bare";
  animated?: boolean;
}) {
  const idPrefix = React.useId();
  const shouldReduceMotion = useReducedMotion();
  const bgGradId = `${idPrefix}-bg`;
  const pageGradId = `${idPrefix}-page`;
  const waveGradId = `${idPrefix}-wave`;

  const canAnimate = animated && !shouldReduceMotion;

  return (
    <motion.svg
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`${className} shrink-0`}
      aria-hidden="true"
      whileHover={canAnimate ? { scale: 1.05, rotate: -2 } : undefined}
      transition={{ type: "spring", stiffness: 360, damping: 20 }}
    >
      <defs>
        <linearGradient
          id={bgGradId}
          x1="10"
          y1="10"
          x2="110"
          y2="110"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#4A6CF7" />
          <stop offset="52%" stopColor="#5B5BF0" />
          <stop offset="100%" stopColor="#8B3DFF" />
        </linearGradient>
        <linearGradient
          id={pageGradId}
          x1="36"
          y1="26"
          x2="64"
          y2="86"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#E0E7FF" />
        </linearGradient>
        <linearGradient
          id={waveGradId}
          x1="58"
          y1="34"
          x2="96"
          y2="82"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#22D3EE" />
        </linearGradient>
      </defs>

      {/* Rounded Violet/Indigo Squircle Badge */}
      <rect width="120" height="120" rx="28" fill={`url(#${bgGradId})`} />

      {/* Back Book Pages */}
      <path
        d="M26 36C26 33.8 27.8 32 30 32H48V82H30C27.8 82 26 80.2 26 78V36Z"
        stroke="#C7D2FE"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.85"
      />
      <path
        d="M33 32V80C33 82 35 84 38 84H56"
        stroke="#E0E7FF"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.9"
      />

      {/* Main Open Memoir Page Morphing into Audio Wave */}
      <path
        d="M40 27C48 27 57 31 61 36V76C57 71 48 68 40 68V27Z"
        fill={`url(#${pageGradId})`}
      />
      <path
        d="M40 76C49 76 56 80 61 86C65 78 69 65 73 59"
        stroke="#E0E7FF"
        strokeWidth="4.5"
        strokeLinecap="round"
      />

      {/* Living Soundwave Bars on the Right */}
      <motion.rect
        x="69"
        y="45"
        width="5"
        height="26"
        rx="2.5"
        fill={`url(#${waveGradId})`}
        animate={
          canAnimate
            ? { y: [45, 40, 47, 45], height: [26, 36, 22, 26] }
            : undefined
        }
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.rect
        x="78"
        y="34"
        width="5.5"
        height="48"
        rx="2.75"
        fill="#FFFFFF"
        animate={
          canAnimate
            ? { y: [34, 41, 31, 34], height: [48, 34, 54, 48] }
            : undefined
        }
        transition={{ duration: 1.9, repeat: Infinity, ease: "easeInOut", delay: 0.25 }}
      />
      <motion.rect
        x="87.5"
        y="43"
        width="5"
        height="30"
        rx="2.5"
        fill={`url(#${waveGradId})`}
        animate={
          canAnimate
            ? { y: [43, 37, 46, 43], height: [30, 42, 24, 30] }
            : undefined
        }
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", delay: 0.45 }}
      />
      <motion.rect
        x="96.5"
        y="51"
        width="4.5"
        height="14"
        rx="2.25"
        fill="#E0E7FF"
        animate={
          canAnimate
            ? { y: [51, 46, 53, 51], height: [14, 24, 10, 14] }
            : undefined
        }
        transition={{ duration: 2.0, repeat: Infinity, ease: "easeInOut", delay: 0.15 }}
      />
    </motion.svg>
  );
}

/**
 * Interactive acoustic waveform sculpture used in hero banners and live studio states.
 */
export function LivingWaveformBar({
  active = true,
  bars = 24,
  className = "",
  bins,
}: {
  active?: boolean;
  bars?: number;
  className?: string;
  bins?: number[];
}) {
  const shouldReduceMotion = useReducedMotion();
  const live = Boolean(bins && bins.length > 0);

  return (
    <div
      className={`flex items-end justify-center gap-1 ${className}`}
      aria-hidden="true"
    >
      {Array.from({ length: bars }).map((_, idx) => {
        const seedHeight = 12 + ((idx * 17) % 28);
        const liveValue = bins?.[idx % (bins?.length || 1)] ?? 0;
        const liveHeight = Math.max(6, Math.round(6 + liveValue * 38));
        return (
          <motion.span
            key={idx}
            className="w-1 rounded-full bg-gradient-to-t from-[#5B5BF0] to-[#7EE7F3]"
            animate={
              live
                ? { height: `${liveHeight}px`, opacity: 0.45 + liveValue * 0.55 }
                : active && !shouldReduceMotion
                  ? {
                      height: [
                        `${seedHeight}px`,
                        `${Math.max(8, 42 - seedHeight)}px`,
                        `${Math.min(44, seedHeight + 14)}px`,
                        `${seedHeight}px`,
                      ],
                      opacity: [0.55, 1, 0.75, 0.55],
                    }
                  : { height: "8px", opacity: 0.35 }
            }
            transition={
              live
                ? { type: "spring", stiffness: 420, damping: 28 }
                : {
                    duration: 1.5 + (idx % 5) * 0.22,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: idx * 0.04,
                  }
            }
          />
        );
      })}
    </div>
  );
}

export function BrandFooter({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#4E5668] ${className}`}
    >
      <div className="flex items-center gap-2.5">
        <span className="font-serif-editorial italic text-base text-[#1C2230]">
          {BRAND.wordmark}
        </span>
        <span className="text-[#B7B1A4]">/</span>
        <span>
          &copy; {BRAND.copyrightYear} {BRAND.name}. All rights reserved.
        </span>
      </div>
      <div className="flex items-center gap-1.5 font-medium text-[#4E5668]">
        <span className="h-1.5 w-1.5 rounded-full bg-[#1AA7BE]" />
        <span>Powered by</span>
        <a
          href={BRAND.poweredByUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold tracking-tight text-[#1C2230] underline-offset-4 hover:text-[#5B5BF0] hover:underline"
        >
          {BRAND.poweredBy}
        </a>
      </div>
    </div>
  );
}
