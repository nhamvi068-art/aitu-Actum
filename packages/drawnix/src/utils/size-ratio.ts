/**
 * 从 size 参数（如 '16x9', '1:1', '1024x1024'）解析为像素尺寸。
 * 支持三种格式：
 *   - WxH 像素格式：'16x9', '1024x1024'
 *   - W:H 比例格式：'1:1', '16:9', '3:4'
 * 基于默认宽度 400px 计算，并保持纵横比一致。
 */
export function parseSizeToPixels(
  size?: string,
  defaultWidth = 400
): { width: number; height: number } {
  if (!size) {
    return { width: defaultWidth, height: defaultWidth };
  }

  // 尝试 W:H 比例格式（支持 : 和 x 两种分隔符）
  const ratioMatch = size.match(/^(\d+):(\d+)$/) || size.match(/^(\d+)x(\d+)$/);
  if (ratioMatch) {
    const ratioWidth = parseInt(ratioMatch[1], 10);
    const ratioHeight = parseInt(ratioMatch[2], 10);
    if (ratioWidth > 0 && ratioHeight > 0) {
      return {
        width: defaultWidth,
        height: Math.round(defaultWidth * (ratioHeight / ratioWidth)),
      };
    }
  }

  return { width: defaultWidth, height: defaultWidth };
}
