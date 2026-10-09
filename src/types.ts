import type { MutableRefObject } from 'react';

/**
 * Базовая структура сообщения в чате.
 */
export interface ChatMessage { 
  role: 'user' | 'assistant'; 
  message: string; 
}

/**
 * Структура данных отдельного чата.
 */
export interface Chat { 
  id: string; 
  title: string; 
  messages: ChatMessage[]; 
  model: string; 
  createdAt: number;
  systemPrompt: string;
}

/**
 * Структура для записи статистики использования модели.
 */
export interface ModelUsageRecord { 
  model: string; 
  modelName: string; 
  timestamp: number; 
  responseTime: number; 
  tokens: number; 
  messageLength: number; 
}

/**
 * Настройки генерации ответа.
 */
export interface GenerationSettings {
  temperature: number;
  maxTokens: number;
}

/**
 * Структура для прикрепленных текстовых файлов.
 */
export interface AttachedText {
  name: string;
  content: string;
}

/**
 * Метаданные, возвращаемые адаптером после генерации ответа.
 */
export interface MessageMetadata {
  responseTime?: number;
  tokens?: number;
  model?: string;
  timestamp?: number;
}

/**
 * Опции для кастомного адаптера LM Studio.
 */
export interface LmStudioAdapterOptions {
  modelName: string;
  history?: ChatMessage[];
  systemPrompt?: string;
  generationSettings?: GenerationSettings;
  abortControllerRef?: MutableRefObject<AbortController | null>;
  onMessageSent?: (message: string) => void;
  onMessageReceived?: (message: string, metadata?: MessageMetadata) => void;
  attachedImages?: string[];
  attachedTexts?: AttachedText[];
}