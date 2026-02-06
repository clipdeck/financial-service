import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { logger } from './logger';

function createClient(baseURL: string | undefined, serviceName: string): AxiosInstance {
  const client = axios.create({
    baseURL: baseURL || '',
    timeout: 5000,
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Service': 'financial-service',
    },
  });

  client.interceptors.response.use(
    (response) => response,
    (error) => {
      logger.error(
        { service: serviceName, url: error.config?.url, status: error.response?.status },
        `${serviceName} request failed`
      );
      throw error;
    }
  );

  return client;
}

export const campaignClient = config.campaignServiceUrl
  ? createClient(config.campaignServiceUrl, 'campaign-service')
  : null;

export const clipClient = config.clipServiceUrl
  ? createClient(config.clipServiceUrl, 'clip-service')
  : null;
