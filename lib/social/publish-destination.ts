export const PUBLISH_DESTINATION_KEYS = ["pageId", "publishOwnerId", "publishChatId"] as const;
export type PublishDestinationKey = (typeof PUBLISH_DESTINATION_KEYS)[number];

export function isPublishDestinationKey(value: string): value is PublishDestinationKey {
  return (PUBLISH_DESTINATION_KEYS as readonly string[]).includes(value);
}
