import { Readable } from 'node:stream';
import cloudinary from 'cloudinary';

const resourceTypes = new Set(['image', 'video', 'raw']);

export function createCloudinaryMediaStore({ cloudName, apiKey, apiSecret }, dependencies = {}) {
  if (!cloudName || !apiKey || !apiSecret) throw new Error('Cloudinary media storage is not configured');
  const client = dependencies.client || cloudinary.v2;
  if (!dependencies.client) client.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });

  return {
    async upload({ buffer, folder, resourceType = 'image', access = 'public' }) {
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('A non-empty file buffer is required');
      if (!resourceTypes.has(resourceType)) throw new Error('Media resource type must be image, video, or raw');
      if (typeof folder !== 'string' || !/^[a-zA-Z0-9/_-]{1,180}$/.test(folder) || folder.includes('..')) throw new Error('Media folder is invalid');
      if (!['public', 'private'].includes(access)) throw new Error('Media access must be public or private');

      const result = await new Promise((resolve, reject) => {
        const stream = client.uploader.upload_stream({
          folder,
          resource_type: resourceType,
          type: access === 'private' ? 'authenticated' : 'upload',
          unique_filename: true,
          use_filename: false,
          overwrite: false
        }, (error, uploaded) => error ? reject(error) : resolve(uploaded));
        Readable.from(buffer).pipe(stream);
      });
      return {
        assetId: result.asset_id,
        publicId: result.public_id,
        resourceType: result.resource_type,
        access: result.type === 'authenticated' ? 'private' : 'public',
        secureUrl: access === 'public' ? result.secure_url : null,
        format: result.format,
        bytes: result.bytes
      };
    },

    createPrivateDownloadUrl({ publicId, resourceType = 'raw', format, expiresIn = 300 }) {
      if (typeof publicId !== 'string' || !publicId || publicId.includes('..')) throw new Error('Cloudinary public ID is invalid');
      if (!resourceTypes.has(resourceType)) throw new Error('Media resource type must be image, video, or raw');
      if (!Number.isInteger(expiresIn) || expiresIn < 60 || expiresIn > 3600) throw new Error('Private link expiry must be between 60 and 3,600 seconds');
      const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
      return client.utils.private_download_url(publicId, format, {
        resource_type: resourceType,
        type: 'authenticated',
        expires_at: expiresAt,
        attachment: true
      });
    },

    async remove({ publicId, resourceType = 'image', access = 'public' }) {
      if (typeof publicId !== 'string' || !publicId || publicId.includes('..')) throw new Error('Cloudinary public ID is invalid');
      if (!resourceTypes.has(resourceType)) throw new Error('Media resource type must be image, video, or raw');
      const response = await client.uploader.destroy(publicId, {
        resource_type: resourceType,
        type: access === 'private' ? 'authenticated' : 'upload',
        invalidate: true
      });
      return response.result === 'ok';
    }
  };
}

export function createConfiguredMediaStore(env = process.env, dependencies) {
  if ((env.MEDIA_STORAGE_PROVIDER || 'disabled') !== 'cloudinary') throw new Error('MEDIA_STORAGE_PROVIDER must be cloudinary to use media storage');
  return createCloudinaryMediaStore({
    cloudName: env.CLOUDINARY_CLOUD_NAME,
    apiKey: env.CLOUDINARY_API_KEY,
    apiSecret: env.CLOUDINARY_API_SECRET
  }, dependencies);
}
