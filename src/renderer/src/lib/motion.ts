/**
 * Shared motion configuration for consistent animations across the app
 * Following Linear/Arc/Raycast design principles
 */

import { Transition, Variants } from 'framer-motion'

// ============================================================================
// TIMING CONSTANTS
// ============================================================================

export const MOTION_TIMING = {
  // Fast interactions (hover, focus)
  fast: 0.15,
  // Standard UI transitions (modals, drawers)
  standard: 0.25,
  // Slower, more deliberate animations (page transitions)
  slow: 0.4,
  // Number animations
  number: 0.6,
} as const

export const MOTION_EASE = {
  // Smooth deceleration (most common)
  out: [0.16, 1, 0.3, 1],
  // Smooth acceleration
  in: [0.7, 0, 0.84, 0],
  // Smooth both ways
  inOut: [0.65, 0, 0.35, 1],
  // Bouncy spring
  spring: [0.34, 1.56, 0.64, 1],
} as const

// ============================================================================
// SPRING CONFIGURATIONS
// ============================================================================

export const SPRING_CONFIGS = {
  // Gentle spring for smooth animations
  gentle: {
    type: 'spring' as const,
    stiffness: 120,
    damping: 14,
    mass: 0.8,
  },
  // Snappy spring for quick interactions
  snappy: {
    type: 'spring' as const,
    stiffness: 400,
    damping: 30,
    mass: 0.8,
  },
  // Bouncy spring for playful interactions
  bouncy: {
    type: 'spring' as const,
    stiffness: 300,
    damping: 20,
    mass: 1.2,
  },
} as const

// ============================================================================
// REUSABLE TRANSITIONS
// ============================================================================

export const transitions = {
  fast: {
    duration: MOTION_TIMING.fast,
    ease: MOTION_EASE.out,
  },
  standard: {
    duration: MOTION_TIMING.standard,
    ease: MOTION_EASE.out,
  },
  slow: {
    duration: MOTION_TIMING.slow,
    ease: MOTION_EASE.out,
  },
  spring: SPRING_CONFIGS.gentle,
  springSnappy: SPRING_CONFIGS.snappy,
  springBouncy: SPRING_CONFIGS.bouncy,
} as const

// ============================================================================
// REUSABLE VARIANTS
// ============================================================================

/**
 * Card hover lift effect - scale up slightly with shadow increase
 */
export const cardHoverVariants: Variants = {
  initial: {
    scale: 1,
    y: 0,
  },
  hover: {
    scale: 1.02,
    y: -2,
    transition: transitions.fast,
  },
  tap: {
    scale: 0.98,
    transition: transitions.fast,
  },
}

/**
 * Fade in from below (common for list items, cards)
 */
export const fadeInUpVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 12,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: transitions.standard,
  },
}

/**
 * Fade in from right (page transitions)
 */
export const fadeInRightVariants: Variants = {
  hidden: {
    opacity: 0,
    x: 12,
  },
  visible: {
    opacity: 1,
    x: 0,
    transition: transitions.standard,
  },
}

/**
 * Scale in (modals, popovers)
 */
export const scaleInVariants: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.95,
  },
  visible: {
    opacity: 1,
    scale: 1,
    transition: transitions.standard,
  },
}

/**
 * Shake animation for errors/warnings
 */
export const shakeVariants: Variants = {
  shake: {
    x: [-4, 4, -4, 4, -2, 2, 0],
    transition: {
      duration: 0.4,
      ease: 'easeInOut',
    },
  },
}

/**
 * Stagger children animation
 */
export const staggerContainerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1,
    },
  },
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Create a staggered fade-in animation with custom delay
 */
export function createStaggerVariants(staggerDelay = 0.05, initialDelay = 0): Variants {
  return {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: staggerDelay,
        delayChildren: initialDelay,
      },
    },
  }
}

/**
 * Create a delayed animation
 */
export function withDelay(delay: number, transition: Transition = transitions.standard): Transition {
  return {
    ...transition,
    delay,
  }
}

/**
 * Number animation configuration for smooth count-up/down
 */
export const numberSpringConfig = {
  stiffness: 100,
  damping: 30,
  mass: 1,
}

// Made with Bob
