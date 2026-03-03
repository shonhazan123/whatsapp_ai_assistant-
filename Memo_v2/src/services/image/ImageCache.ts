/**
 * Image Analysis Cache
 * Caches image analysis results to avoid re-analyzing the same images
 */

import type { ImageAnalysisResult } from "../../types/imageAnalysis.js";
import { logger } from "../../utils/logger.js";
import { ImageProcessor } from "./ImageProcessor.js";

interface CacheEntry {
	result: ImageAnalysisResult;
	timestamp: number;
	hash: string;
}

export class ImageCache {
	private static instance: ImageCache;
	private cache: Map<string, CacheEntry> = new Map();
	private readonly TTL = 24 * 60 * 60 * 1000; // 24 hours
	private readonly MAX_CACHE_SIZE = 100; // Maximum number of cached entries

	private constructor() {
		// Clean up expired entries every hour
		setInterval(() => this.cleanup(), 60 * 60 * 1000);
	}

	public static getInstance(): ImageCache {
		if (!ImageCache.instance) {
			ImageCache.instance = new ImageCache();
		}
		return ImageCache.instance;
	}

	/** Cache key = image hash + response language so same image can have different language responses */
	private cacheKey(hash: string, language?: string): string {
		return language ? `${hash}_${language}` : hash;
	}

	/**
	 * Get cached analysis result for an image (optionally for a specific response language)
	 */
	public get(imageBuffer: Buffer, language?: string): ImageAnalysisResult | null {
		const hash = ImageProcessor.generateImageHash(imageBuffer);
		const key = this.cacheKey(hash, language);
		const entry = this.cache.get(key);

		if (!entry) {
			return null;
		}

		// Check if entry is expired
		if (Date.now() - entry.timestamp > this.TTL) {
			this.cache.delete(key);
			logger.debug(`Cache entry expired for hash: ${hash.substring(0, 8)}...`);
			return null;
		}

		logger.info(`✅ Cache hit for image hash: ${hash.substring(0, 8)}...`);
		return entry.result;
	}

	/**
	 * Store analysis result in cache (optionally keyed by response language)
	 */
	public set(imageBuffer: Buffer, result: ImageAnalysisResult, language?: string): void {
		const hash = ImageProcessor.generateImageHash(imageBuffer);
		const key = this.cacheKey(hash, language);

		// Enforce max cache size
		if (this.cache.size >= this.MAX_CACHE_SIZE) {
			this.evictOldest();
		}

		this.cache.set(key, {
			result,
			timestamp: Date.now(),
			hash,
		});

		logger.debug(
			`💾 Cached analysis result for image hash: ${hash.substring(0, 8)}...`,
		);
	}

	/**
	 * Clear expired entries
	 */
	private cleanup(): void {
		const now = Date.now();
		let cleaned = 0;

		for (const [hash, entry] of this.cache.entries()) {
			if (now - entry.timestamp > this.TTL) {
				this.cache.delete(hash);
				cleaned++;
			}
		}

		if (cleaned > 0) {
			logger.info(`🧹 Cleaned up ${cleaned} expired cache entries`);
		}
	}

	/**
	 * Evict oldest entry when cache is full
	 */
	private evictOldest(): void {
		let oldestHash: string | null = null;
		let oldestTimestamp = Date.now();

		for (const [hash, entry] of this.cache.entries()) {
			if (entry.timestamp < oldestTimestamp) {
				oldestTimestamp = entry.timestamp;
				oldestHash = hash;
			}
		}

		if (oldestHash) {
			this.cache.delete(oldestHash);
			logger.debug(
				`🗑️  Evicted oldest cache entry: ${oldestHash.substring(0, 8)}...`,
			);
		}
	}

	/**
	 * Clear all cache entries
	 */
	public clear(): void {
		this.cache.clear();
		logger.info("🗑️  Image cache cleared");
	}

	/**
	 * Get cache statistics
	 */
	public getStats(): { size: number; maxSize: number; ttl: number } {
		return {
			size: this.cache.size,
			maxSize: this.MAX_CACHE_SIZE,
			ttl: this.TTL,
		};
	}
}
