/**
 * Forge Marketplace Routes
 * Package discovery, installation, publishing, and ratings
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';
import { logAudit } from '../observability/audit.js';

interface MarketplacePackageRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  long_description: string | null;
  author_name: string;
  author_url: string | null;
  package_type: string;
  version: string;
  icon_url: string | null;
  repository_url: string | null;
  install_config: Record<string, unknown>;
  required_env_vars: string[];
  tags: string[];
  avg_rating: string | null;
  install_count: number;
  is_verified: boolean;
  is_featured: boolean;
  status: string;
  created_at: string;
  updated_at: string;
}

interface MarketplaceRatingRow {
  id: string;
  package_id: string;
  user_id: string;
  rating: number;
  review: string | null;
  created_at: string;
}

interface MarketplaceInstallRow {
  id: string;
  package_id: string;
  user_id: string;
  installed_resource_id: string;
  installed_resource_type: string;
  installed_at: string;
}

export async function marketplaceRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/forge/marketplace/packages - List/search marketplace packages
   */
  app.get(
    '/api/v1/forge/marketplace/packages',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const qs = request.query as {
        type?: string;
        tag?: string;
        featured?: string;
        search?: string;
        sort?: string;
        limit?: string;
        offset?: string;
      };

      const conditions: string[] = ['status = \'published\''];
      const params: unknown[] = [];
      let paramIndex = 1;

      if (qs.type) {
        const validTypes = ['mcp_server', 'skill_template', 'tool_bundle'];
        if (!validTypes.includes(qs.type)) {
          return reply.status(400).send({
            error: 'Validation Error',
            message: `package_type must be one of: ${validTypes.join(', ')}`,
          });
        }
        conditions.push(`package_type = $${paramIndex}`);
        params.push(qs.type);
        paramIndex++;
      }

      if (qs.tag) {
        conditions.push(`$${paramIndex} = ANY(tags)`);
        params.push(qs.tag);
        paramIndex++;
      }

      if (qs.featured !== undefined) {
        conditions.push(`is_featured = $${paramIndex}`);
        params.push(qs.featured === 'true');
        paramIndex++;
      }

      if (qs.search) {
        conditions.push(`(name ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`);
        params.push(`%${qs.search}%`);
        paramIndex++;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const validSorts: Record<string, string> = {
        rating: 'avg_rating DESC NULLS LAST',
        installs: 'install_count DESC',
        recent: 'created_at DESC',
      };
      const orderBy = validSorts[qs.sort ?? ''] ?? 'install_count DESC';

      const limit = Math.max(1, Math.min(parseInt(qs.limit ?? '50', 10) || 50, 200));
      const offset = Math.max(0, parseInt(qs.offset ?? '0', 10) || 0);

      const [packages, countResult] = await Promise.all([
        query<MarketplacePackageRow>(
          `SELECT * FROM marketplace_packages
           ${whereClause}
           ORDER BY ${orderBy}
           LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
          [...params, limit, offset],
        ),
        query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM marketplace_packages ${whereClause}`,
          params,
        ),
      ]);

      const total = parseInt(countResult[0]?.count ?? '0', 10);

      return reply.send({ packages, total, limit, offset });
    },
  );

  /**
   * GET /api/v1/forge/marketplace/packages/:slug - Get package detail with ratings
   */
  app.get(
    '/api/v1/forge/marketplace/packages/:slug',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { slug } = request.params as { slug: string };

      const pkg = await queryOne<MarketplacePackageRow>(
        `SELECT * FROM marketplace_packages WHERE slug = $1`,
        [slug],
      );

      if (!pkg) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Package not found',
        });
      }

      const ratings = await query<MarketplaceRatingRow>(
        `SELECT * FROM marketplace_ratings
         WHERE package_id = $1
         ORDER BY created_at DESC
         LIMIT 50`,
        [pkg.id],
      );

      return reply.send({ package: pkg, ratings });
    },
  );

  /**
   * POST /api/v1/forge/marketplace/packages/:slug/install - Install a package
   */
  app.post(
    '/api/v1/forge/marketplace/packages/:slug/install',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { slug } = request.params as { slug: string };

      const pkg = await queryOne<MarketplacePackageRow>(
        `SELECT * FROM marketplace_packages WHERE slug = $1 AND status = 'published'`,
        [slug],
      );

      if (!pkg) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Package not found',
        });
      }

      // Check if already installed by this user
      const existingInstall = await queryOne<{ id: string }>(
        `SELECT id FROM marketplace_installs WHERE package_id = $1 AND user_id = $2`,
        [pkg.id, userId],
      );

      if (existingInstall) {
        return reply.status(409).send({
          error: 'Conflict',
          message: 'Package is already installed',
        });
      }

      // Create the installed resource based on package type
      const installConfig = pkg.install_config;
      let installedResourceId: string;
      let installedResourceType: string;

      if (pkg.package_type === 'mcp_server') {
        installedResourceId = ulid();
        installedResourceType = 'mcp_server';

        await queryOne(
          `INSERT INTO forge_mcp_servers (id, owner_id, name, description, transport_type, connection_config)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [
            installedResourceId,
            userId,
            installConfig['name'] ?? pkg.name,
            installConfig['description'] ?? pkg.description,
            installConfig['transportType'] ?? 'stdio',
            JSON.stringify(installConfig['connectionConfig'] ?? {}),
          ],
        );
      } else if (pkg.package_type === 'skill_template' || pkg.package_type === 'tool_bundle') {
        installedResourceId = ulid();
        installedResourceType = pkg.package_type;

        await queryOne(
          `INSERT INTO forge_tools (id, name, display_name, description, type, risk_level, input_schema, output_schema, config)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [
            installedResourceId,
            installConfig['name'] ?? pkg.slug,
            installConfig['displayName'] ?? pkg.name,
            installConfig['description'] ?? pkg.description,
            installConfig['type'] ?? 'custom',
            installConfig['riskLevel'] ?? 'low',
            JSON.stringify(installConfig['inputSchema'] ?? {}),
            JSON.stringify(installConfig['outputSchema'] ?? {}),
            JSON.stringify(installConfig['config'] ?? {}),
          ],
        );
      } else {
        return reply.status(400).send({
          error: 'Validation Error',
          message: `Unsupported package type: ${pkg.package_type}`,
        });
      }

      // Record the installation
      const installId = ulid();
      const install = await queryOne<MarketplaceInstallRow>(
        `INSERT INTO marketplace_installs (id, package_id, user_id, installed_resource_id, installed_resource_type)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [installId, pkg.id, userId, installedResourceId, installedResourceType],
      );

      // Increment install count
      await query(
        `UPDATE marketplace_packages SET install_count = install_count + 1, updated_at = NOW() WHERE id = $1`,
        [pkg.id],
      );

      void logAudit({
        ownerId: userId,
        action: 'marketplace.install',
        resourceType: 'marketplace_package',
        resourceId: pkg.id,
        details: { slug: pkg.slug, packageType: pkg.package_type, installedResourceId },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      }).catch((e) => { if (e) console.debug("[catch]", String(e)); });

      return reply.status(201).send({ install, installedResourceId, installedResourceType });
    },
  );

  /**
   * POST /api/v1/forge/marketplace/packages - Publish a new package
   */
  app.post(
    '/api/v1/forge/marketplace/packages',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = request.body as {
        slug: string;
        name: string;
        description: string;
        longDescription?: string;
        authorName: string;
        authorUrl?: string;
        packageType: string;
        version: string;
        iconUrl?: string;
        repositoryUrl?: string;
        installConfig: Record<string, unknown>;
        requiredEnvVars?: string[];
        tags?: string[];
      };

      if (!body.slug || !body.name || !body.description || !body.authorName || !body.packageType || !body.version || !body.installConfig) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'slug, name, description, authorName, packageType, version, and installConfig are required',
        });
      }

      const validTypes = ['mcp_server', 'skill_template', 'tool_bundle'];
      if (!validTypes.includes(body.packageType)) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: `packageType must be one of: ${validTypes.join(', ')}`,
        });
      }

      // Check for slug collision
      const existing = await queryOne<{ id: string }>(
        `SELECT id FROM marketplace_packages WHERE slug = $1`,
        [body.slug],
      );

      if (existing) {
        return reply.status(409).send({
          error: 'Conflict',
          message: `A package with slug '${body.slug}' already exists`,
        });
      }

      const id = ulid();

      const pkg = await queryOne<MarketplacePackageRow>(
        `INSERT INTO marketplace_packages (id, slug, name, description, long_description, author_name, author_url, package_type, version, icon_url, repository_url, install_config, required_env_vars, tags, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'published')
         RETURNING *`,
        [
          id,
          body.slug,
          body.name,
          body.description,
          body.longDescription ?? null,
          body.authorName,
          body.authorUrl ?? null,
          body.packageType,
          body.version,
          body.iconUrl ?? null,
          body.repositoryUrl ?? null,
          JSON.stringify(body.installConfig),
          body.requiredEnvVars ?? [],
          body.tags ?? [],
        ],
      );

      void logAudit({
        ownerId: userId,
        action: 'marketplace.publish',
        resourceType: 'marketplace_package',
        resourceId: id,
        details: { slug: body.slug, packageType: body.packageType, version: body.version },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      }).catch((e) => { if (e) console.debug("[catch]", String(e)); });

      return reply.status(201).send({ package: pkg });
    },
  );

  /**
   * POST /api/v1/forge/marketplace/packages/:slug/rate - Submit or update a rating
   */
  app.post(
    '/api/v1/forge/marketplace/packages/:slug/rate',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { slug } = request.params as { slug: string };
      const body = request.body as {
        rating: number;
        review?: string;
      };

      if (!body.rating || body.rating < 1 || body.rating > 5 || !Number.isInteger(body.rating)) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'rating is required and must be an integer between 1 and 5',
        });
      }

      const pkg = await queryOne<MarketplacePackageRow>(
        `SELECT * FROM marketplace_packages WHERE slug = $1`,
        [slug],
      );

      if (!pkg) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Package not found',
        });
      }

      // Upsert rating (unique on package_id + user_id)
      const ratingId = ulid();
      const rating = await queryOne<MarketplaceRatingRow>(
        `INSERT INTO marketplace_ratings (id, package_id, user_id, rating, review)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (package_id, user_id) DO UPDATE
           SET rating = EXCLUDED.rating, review = EXCLUDED.review
         RETURNING *`,
        [ratingId, pkg.id, userId, body.rating, body.review ?? null],
      );

      // Recalculate average rating
      await query(
        `UPDATE marketplace_packages
         SET avg_rating = (SELECT ROUND(AVG(rating)::numeric, 2) FROM marketplace_ratings WHERE package_id = $1),
             updated_at = NOW()
         WHERE id = $1`,
        [pkg.id],
      );

      void logAudit({
        ownerId: userId,
        action: 'marketplace.rate',
        resourceType: 'marketplace_package',
        resourceId: pkg.id,
        details: { slug: pkg.slug, rating: body.rating },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      }).catch((e) => { if (e) console.debug("[catch]", String(e)); });

      return reply.send({ rating });
    },
  );

  /**
   * DELETE /api/v1/forge/marketplace/packages/:slug/uninstall - Remove installed package
   */
  app.delete(
    '/api/v1/forge/marketplace/packages/:slug/uninstall',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { slug } = request.params as { slug: string };

      const pkg = await queryOne<MarketplacePackageRow>(
        `SELECT * FROM marketplace_packages WHERE slug = $1`,
        [slug],
      );

      if (!pkg) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Package not found',
        });
      }

      const install = await queryOne<MarketplaceInstallRow>(
        `SELECT * FROM marketplace_installs WHERE package_id = $1 AND user_id = $2`,
        [pkg.id, userId],
      );

      if (!install) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Package is not installed',
        });
      }

      // Remove the installed resource
      if (install.installed_resource_type === 'mcp_server') {
        await query(
          `DELETE FROM forge_mcp_servers WHERE id = $1 AND owner_id = $2`,
          [install.installed_resource_id, userId],
        );
      } else {
        await query(
          `DELETE FROM forge_tools WHERE id = $1`,
          [install.installed_resource_id],
        );
      }

      // Remove the install record
      await query(
        `DELETE FROM marketplace_installs WHERE id = $1`,
        [install.id],
      );

      // Decrement install count
      await query(
        `UPDATE marketplace_packages SET install_count = GREATEST(install_count - 1, 0), updated_at = NOW() WHERE id = $1`,
        [pkg.id],
      );

      void logAudit({
        ownerId: userId,
        action: 'marketplace.uninstall',
        resourceType: 'marketplace_package',
        resourceId: pkg.id,
        details: { slug: pkg.slug, installedResourceId: install.installed_resource_id },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      }).catch((e) => { if (e) console.debug("[catch]", String(e)); });

      return reply.send({ message: 'Package uninstalled successfully' });
    },
  );
}
