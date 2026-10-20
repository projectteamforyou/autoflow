import {
  Activity, AppWindow, ArrowDownUp, ArrowLeft, BadgeCheck, Bell, Bolt, Book, BookOpen, Boxes, Bug, Check, ChevronDown, ChevronRight, ChevronUp, CircleHelp, Clipboard, Cloud, CloudOff,
  Command, Copy, CornerDownRight, Cpu, Download, ExternalLink, Eye, FileJson, FileText, FlaskConical, Gamepad2, GitBranch, Globe, GripVertical, Hand, History, Home, Hourglass,
  Image, Info, Keyboard, Languages, Layers, LayoutGrid, LayoutTemplate, ListOrdered, Lock, LogOut, Map, MessageCircleQuestion, Monitor, Moon, MousePointer2, MousePointerClick,
  Move, OctagonX, PanelsTopLeft, Pause, Pen, Play, Plus, Pointer, Radio, Repeat, RotateCcw, Save, ScanSearch, ScanText, ScrollText, Search, Send, Settings, Share2, Shield,
  ShieldAlert, ShieldCheck, SkipForward, Smartphone, Sparkles, Square, Star, StepForward, Sun, Table, Tag, Target, Timer, TimerReset, Trash2, Type, Upload, User, Variable,
  Wand2, Workflow, X, Zap, Brain, Wrench, KeyRound, Link, Palette, Layout, Eraser, Code2, Wifi, BatteryCharging, MapPin, CreditCard, MonitorPlay, Pipette, ScanEye, Crosshair, Images, Camera, Hash, MonitorCog,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  Activity, AppWindow, ArrowDownUp, ArrowLeft, BadgeCheck, Bell, Bolt, Book, BookOpen, Boxes, Bug, Check, ChevronDown, ChevronRight, ChevronUp, CircleHelp, Clipboard, Cloud, CloudOff,
  Command, Copy, CornerDownRight, Cpu, Download, ExternalLink, Eye, FileJson, FileText, FlaskConical, Gamepad2, GitBranch, Globe, GripVertical, Hand, History, Home, Hourglass,
  Image, Info, Keyboard, Languages, Layers, LayoutGrid, LayoutTemplate, ListOrdered, Lock, LogOut, Map, MessageCircleQuestion, Monitor, Moon, MousePointer2, MousePointerClick,
  Move, OctagonX, PanelsTopLeft, Pause, Pen, Play, Plus, Pointer, Radio, Repeat, RotateCcw, Save, ScanSearch, ScanText, ScrollText, Search, Send, Settings, Share2, Shield,
  ShieldAlert, ShieldCheck, SkipForward, Smartphone, Sparkles, Square, Star, StepForward, Sun, Table, Tag, Target, Timer, TimerReset, Trash2, Type, Upload, User, Variable,
  Wand2, Workflow, X, Zap, Brain, Wrench, KeyRound, Link, Palette, Layout, Eraser, Code2, Wifi, BatteryCharging, MapPin, CreditCard, MonitorPlay, Pipette, ScanEye, Crosshair, Images, Camera, Hash, MonitorCog,
  // aliases used by flow/template icon names
  bolt: Zap, cursor: MousePointerClick, target: Target, keyboard: Keyboard, pen: Pen, table: Table, eye: Eye, pulse: Activity, flask: FlaskConical, book: BookOpen, hand: Hand,
  phone: Smartphone, moon: Moon, layout: Layout, globe: Globe, clipboard: Clipboard, timer: Timer, gamepad: Gamepad2, sparkles: Sparkles, workflow: Workflow,
};

export const FLOW_ICON_CHOICES = ["bolt", "cursor", "target", "keyboard", "pen", "table", "eye", "pulse", "flask", "book", "hand", "phone", "moon", "layout", "globe", "clipboard", "timer", "gamepad", "sparkles", "workflow"];

export function Icon({ name, size = 18, className, strokeWidth = 2 }: { name: string; size?: number; className?: string; strokeWidth?: number }) {
  const C = ICONS[name] ?? Zap;
  return <C size={size} className={className} strokeWidth={strokeWidth} aria-hidden="true" />;
}
