/**
 * 给异步 VMD 加载分配递增版本号，确保较晚完成的旧请求不能覆盖最新预览。
 */
export function createRezeVmdRequestGuard() {
  let currentRequestId = 0;

  return {
    begin() {
      currentRequestId += 1;
      return currentRequestId;
    },
    isCurrent(requestId) {
      return requestId === currentRequestId;
    },
  };
}
