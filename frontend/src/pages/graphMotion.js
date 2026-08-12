const DEFAULT_REPULSION_GAP = 42;
const DEFAULT_MAX_IMPULSE = 3.8;

/**
 * 将任意节点 ID 转成稳定的无符号散列值。
 * 稳定散列用于错开各节点的动画相位，避免所有节点像时钟一样同步摆动。
 */
function hashNodeId(nodeId) {
  const value = String(nodeId);
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

/**
 * 计算节点当前帧的轻微形变参数。
 * 返回值只描述以节点中心为原点的旋转和缩放，不包含平移，因此不会改变节点中心、连线端点或命中区域。
 */
export function getNodeSway(nodeId, timeMs, disabled = false) {
  if (disabled) {
    return {
      active: false,
      angle: 0,
      scaleX: 1,
      scaleY: 1,
      shear: 0,
      wind: 0,
      dashOffset: 0,
    };
  }

  const hash = hashNodeId(nodeId);
  const phase = (hash % 6283) / 1000;
  const periodMs = 2400 + (hash % 1200);
  const progress = (timeMs / periodMs) * Math.PI * 2 + phase;
  const wind = Math.sin(progress) + Math.sin(progress * 0.47 + phase * 0.6) * 0.24;
  const stretch = Math.sin(progress * 0.83 + phase + Math.PI / 3);

  return {
    active: true,
    angle: wind * 0.085,
    scaleX: 1 + stretch * 0.12,
    scaleY: 1 - stretch * 0.07,
    shear: wind * 0.105,
    wind,
    dashOffset: -(timeMs / 95 + (hash % 37)),
  };
}

/**
 * 计算拖动节点对单个邻近节点产生的径向冲量。
 * 力度随距离连续衰减；完全重合时使用由节点 ID 推导的稳定方向，避免 NaN 和随机抖动。
 */
export function calculateRepulsionImpulse({
  draggedNode,
  nearbyNode,
  draggedRadius,
  nearbyRadius,
  gap = DEFAULT_REPULSION_GAP,
  maxImpulse = DEFAULT_MAX_IMPULSE,
}) {
  const deltaX = nearbyNode.x - draggedNode.x;
  const deltaY = nearbyNode.y - draggedNode.y;
  const distance = Math.hypot(deltaX, deltaY);
  const influenceRadius = draggedRadius + nearbyRadius + gap;

  if (!Number.isFinite(distance) || distance >= influenceRadius) {
    return { x: 0, y: 0, strength: 0 };
  }

  let directionX;
  let directionY;

  if (distance > 0.001) {
    directionX = deltaX / distance;
    directionY = deltaY / distance;
  } else {
    const fallbackAngle = (hashNodeId(`${draggedNode.id}:${nearbyNode.id}`) % 6283) / 1000;
    directionX = Math.cos(fallbackAngle);
    directionY = Math.sin(fallbackAngle);
  }

  // 使用平方曲线让影响半径边缘过渡自然，同时在接近重合时提供清晰的弹开反馈。
  const proximity = 1 - distance / influenceRadius;
  const strength = maxImpulse * proximity * proximity;

  return {
    x: directionX * strength,
    y: directionY * strength,
    strength,
  };
}

/**
 * 对累计速度做矢量限幅，确保高频 pointermove 或多个冲量叠加时不会出现节点瞬移。
 */
export function limitVector(vector, maxMagnitude) {
  const magnitude = Math.hypot(vector.x, vector.y);
  if (!Number.isFinite(magnitude) || magnitude === 0) return { x: 0, y: 0 };
  if (magnitude <= maxMagnitude) return vector;

  const ratio = maxMagnitude / magnitude;
  return { x: vector.x * ratio, y: vector.y * ratio };
}

/**
 * 将下一帧位置限制在本次拖拽允许的最大位移范围内，防止反复靠近同一节点后整张图逐渐扩散。
 */
export function getBoundedPosition(origin, current, velocity, frameScale, maxDisplacement) {
  const candidate = {
    x: current.x + velocity.x * frameScale,
    y: current.y + velocity.y * frameScale,
  };
  const offset = { x: candidate.x - origin.x, y: candidate.y - origin.y };
  const boundedOffset = limitVector(offset, maxDisplacement);

  return {
    x: origin.x + boundedOffset.x,
    y: origin.y + boundedOffset.y,
  };
}
