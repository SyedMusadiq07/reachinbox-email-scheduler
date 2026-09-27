export interface EmailDeliveryJobData {
  emailJobId: string;
}

export interface EmailDeliveryJobResult {
  accepted: true;
  emailJobId: string;
}

export const EMAIL_QUEUE_NAME = "email";
export const EMAIL_DELIVERY_JOB_NAME = "email-delivery";
