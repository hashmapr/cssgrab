export interface ExtractedElement {
  url: string;
  selector: string;
  tag: string;
  classList: string[];
  outerHTMLSnippet: string;
  computedStyles: Record<string, string>;
  sourceCSSRules: string[];
  keyframes: KeyframeBlock[];
  webAnimations: WebAnimationData[];
  gsapCalls: GsapCall[];
  isCanvas: boolean;
  cssVariables: Record<string, string>;
  observedAnimations?: string[];
}

export interface KeyframeBlock {
  name: string;
  cssText: string;
}

export interface WebAnimationData {
  animationName: string | null;
  duration: number | string;
  easing: string;
  delay: number;
  iterations: number;
  keyframes: Record<string, unknown>[];
}

export interface GsapCall {
  method: "to" | "from" | "fromTo" | "set" | "timeline";
  target: string;
  vars: Record<string, unknown>;
}

export type Stack = "react+tailwind" | "vue+css" | "html+css" | "next+tailwind";

export interface GenerateOptions {
  stack: Stack;
  context?: string;
}

export interface GenerateResult {
  code: string;
  explanation: string;
  isCanvas: boolean;
  canvasNote?: string;
}
