export const formatMAC = (str?: string) =>
  str?.toUpperCase()?.replaceAll(/[^A-F0-9]/g, '')?.match(/.{2}/g)?.join(':');