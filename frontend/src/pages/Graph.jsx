import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ForceGraph2D from "react-force-graph-2d";
import { getGraphData, getTopics } from "../api/interview";
import { getTopicIcon } from "../utils/topicIcons";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  calculateRepulsionImpulse,
  getBoundedPosition,
  getNodeSway,
  limitVector,
} from "./graphMotion";

const PAGE_CLASS = "flex-1 w-full max-w-[1600px] mx-auto px-4 py-6 md:px-7 md:py-8 xl:px-10 2xl:px-12";
const SIMILARITY_THRESHOLD = 0.65;
const GRAPH_MIN_HEIGHT = 480;
const GRAPH_STACKED_MAX_HEIGHT = 760;
const REPULSION_STOP_SPEED = 0.045;

// 普通模式保留完整的拖拽排斥反馈；减少动态效果模式只缩短和减弱位移，不取消功能性交互反馈。
const DEFAULT_MOTION_CONFIG = {
  maxImpulse: 3.8,
  maxSpeed: 7,
  maxDisplacement: 54,
  draggingDamping: 0.78,
  releasedDamping: 0.84,
};
const REDUCED_MOTION_CONFIG = {
  maxImpulse: 1.9,
  maxSpeed: 3.5,
  maxDisplacement: 27,
  draggingDamping: 0.61,
  releasedDamping: 0.71,
};

const SCORE_FILTERS = [
  { key: "all", label: "全部" },
  { key: "weak", label: "待补" },
  { key: "mid", label: "临界" },
  { key: "strong", label: "稳定" },
];

export default function Graph() {
  const navigate = useNavigate();
  const [topics, setTopics] = useState({});
  const [selectedTopic, setSelectedTopic] = useState(null);
  const [graphData, setGraphData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hoveredNode, setHoveredNode] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [scoreFilter, setScoreFilter] = useState("all");
  const [areaFilter, setAreaFilter] = useState("all");
  const [zoomLevel, setZoomLevel] = useState(1);
  const [graphReady, setGraphReady] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [isPageVisible, setIsPageVisible] = useState(() => document.visibilityState === "visible");
  const [isGraphInViewport, setIsGraphInViewport] = useState(true);
  const [isNodeMotionActive, setIsNodeMotionActive] = useState(false);
  const pageRef = useRef(null);
  const containerRef = useRef(null);
  const detailsColumnRef = useRef(null);
  const fgRef = useRef(null);
  const initialFitPendingRef = useRef(false);
  const revealFrameRef = useRef(null);
  const zoomFrameRef = useRef(null);
  const nodeMotionRef = useRef({
    frameId: null,
    lastFrameTime: null,
    draggedNodeId: null,
    velocities: new Map(),
    origins: new Map(),
  });
  const motionConfigRef = useRef(
    prefersReducedMotion ? REDUCED_MOTION_CONFIG : DEFAULT_MOTION_CONFIG,
  );
  const [dimensions, setDimensions] = useState({ width: 960, height: 620 });

  const isGraphVisible = isPageVisible && isGraphInViewport;
  const needsContinuousRedraw = isGraphVisible
    && (!prefersReducedMotion || isNodeMotionActive);

  const stopNodeMotion = useCallback(() => {
    const motion = nodeMotionRef.current;
    if (motion.frameId != null) cancelAnimationFrame(motion.frameId);
    motion.frameId = null;
    motion.lastFrameTime = null;
    motion.draggedNodeId = null;
    motion.velocities.clear();
    motion.origins.clear();
    setIsNodeMotionActive(false);
  }, []);

  // 自定义 RAF 通过 ref 读取最新参数，确保用户运行中切换系统偏好时无需中断当前拖拽反馈。
  useEffect(() => {
    motionConfigRef.current = prefersReducedMotion
      ? REDUCED_MOTION_CONFIG
      : DEFAULT_MOTION_CONFIG;
  }, [prefersReducedMotion]);

  useEffect(() => {
    getTopics().then(setTopics).catch(() => {});
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);

    updatePreference();
    mediaQuery.addEventListener?.("change", updatePreference);
    return () => mediaQuery.removeEventListener?.("change", updatePreference);
  }, []);

  useEffect(() => {
    const updatePageVisibility = () => {
      const isVisible = document.visibilityState === "visible";
      if (!isVisible) stopNodeMotion();
      setIsPageVisible(isVisible);
    };

    document.addEventListener("visibilitychange", updatePageVisibility);
    return () => document.removeEventListener("visibilitychange", updatePageVisibility);
  }, [stopNodeMotion]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    // 完全离开视口后才暂停，避免图谱贴近视口边缘时频繁启停渲染循环。
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) stopNodeMotion();
      setIsGraphInViewport(entry.isIntersecting);
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [stopNodeMotion]);

  useEffect(() => () => {
    if (revealFrameRef.current != null) cancelAnimationFrame(revealFrameRef.current);
    if (zoomFrameRef.current != null) cancelAnimationFrame(zoomFrameRef.current);
    if (nodeMotionRef.current.frameId != null) cancelAnimationFrame(nodeMotionRef.current.frameId);
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateDimensions = () => {
      const { width } = element.getBoundingClientRect();
      const detailsColumnHeight = detailsColumnRef.current?.getBoundingClientRect().height ?? 0;
      const isTwoColumnLayout = window.matchMedia("(min-width: 1280px)").matches;

      // 双栏布局以右侧“图谱摘要 + 操作提示”整列为高度基准，保证左右底部始终对齐。
      // 单列布局继续使用宽高比例，避免右侧内容堆叠后把图谱画布异常拉长。
      const height = isTwoColumnLayout && detailsColumnHeight > 0
        ? Math.max(GRAPH_MIN_HEIGHT, detailsColumnHeight)
        : Math.max(GRAPH_MIN_HEIGHT, Math.min(width * 0.62, GRAPH_STACKED_MAX_HEIGHT));

      setDimensions((current) => (
        current.width === width && current.height === height
          ? current
          : { width, height }
      ));
    };

    const observer = new ResizeObserver(updateDimensions);

    observer.observe(element);
    if (detailsColumnRef.current) observer.observe(detailsColumnRef.current);
    if (pageRef.current) observer.observe(pageRef.current);
    window.addEventListener("resize", updateDimensions);
    updateDimensions();

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateDimensions);
    };
  }, []);

  const configureGraphLayout = useCallback(() => {
    const graph = fgRef.current;
    if (!graph) return;

    graph.d3Force("charge")?.strength(-150);
    graph.d3Force("link")?.distance(76);
    graph.d3ReheatSimulation?.();
  }, []);

  const fitGraphToView = useCallback((nodes, duration = 500) => {
    const graph = fgRef.current;
    if (!graph || !nodes?.length) return;

    // 单节点没有可供 zoomToFit 计算的有效跨度，直接居中可避免节点被推到画布边缘后遭到裁切。
    if (nodes.length === 1) {
      const [node] = nodes;
      graph.centerAt(node.x ?? 0, node.y ?? 0, duration);
      graph.zoom(1.8, duration);
      return;
    }

    graph.zoomToFit(duration, 56);
  }, []);

  const handleSelectTopic = async (key) => {
    if (revealFrameRef.current != null) {
      cancelAnimationFrame(revealFrameRef.current);
      revealFrameRef.current = null;
    }

    setSelectedTopic(key);
    setGraphData(null);
    setHoveredNode(null);
    setSelectedNodeId(null);
    setSearchQuery("");
    setScoreFilter("all");
    setAreaFilter("all");
    setGraphReady(false);
    setLoading(true);

    try {
      const data = await getGraphData(key);
      initialFitPendingRef.current = data.nodes.length > 0;
      if (data.nodes.length === 0) setGraphReady(true);
      setGraphData(data);
      setTimeout(() => {
        configureGraphLayout();
      }, 80);
    } catch {
      initialFitPendingRef.current = false;
      setGraphReady(true);
      setGraphData({ nodes: [], links: [] });
    } finally {
      setLoading(false);
    }
  };

  const topicEntries = Object.entries(topics);
  const selectedTopicInfo = selectedTopic ? topics[selectedTopic] : null;
  const focusAreas = useMemo(() => {
    if (!graphData?.nodes?.length) return [];

    return [...new Set(
      graphData.nodes
        .map((node) => node.focus_area?.trim())
        .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [graphData]);

  const filteredGraphData = useMemo(() => {
    if (!graphData) return null;

    const nodes = graphData.nodes.filter((node) => (
      matchesGraphFilters(node, searchQuery, scoreFilter, areaFilter)
    ));

    const visibleIds = new Set(nodes.map((node) => node.id));
    const links = graphData.links.filter((link) => {
      const sourceId = getEntityId(link.source);
      const targetId = getEntityId(link.target);
      return visibleIds.has(sourceId) && visibleIds.has(targetId);
    });

    return { nodes, links };
  }, [areaFilter, graphData, scoreFilter, searchQuery]);

  const applyFilters = (nextSearchQuery, nextScoreFilter, nextAreaFilter) => {
    setSearchQuery(nextSearchQuery);
    setScoreFilter(nextScoreFilter);
    setAreaFilter(nextAreaFilter);
    setHoveredNode(null);

    if (selectedNodeId == null) return;
    const selected = graphData?.nodes?.find((node) => node.id === selectedNodeId);
    if (!selected || !matchesGraphFilters(
      selected,
      nextSearchQuery,
      nextScoreFilter,
      nextAreaFilter,
    )) {
      setSelectedNodeId(null);
    }
  };

  const selectedNode = useMemo(() => {
    if (selectedNodeId == null || !graphData?.nodes) return null;
    return graphData.nodes.find((node) => node.id === selectedNodeId) || null;
  }, [graphData, selectedNodeId]);

  const graphInsights = useMemo(() => {
    const nodes = filteredGraphData?.nodes || [];
    const links = filteredGraphData?.links || [];

    const weakCount = nodes.filter((node) => node.score < 6).length;
    const stableCount = nodes.filter((node) => node.score >= 8).length;
    const avgScore = nodes.length
      ? roundScore(nodes.reduce((sum, node) => sum + node.score, 0) / nodes.length)
      : null;

    const focusAreaMap = new Map();
    for (const node of nodes) {
      const key = node.focus_area || "未标注";
      focusAreaMap.set(key, (focusAreaMap.get(key) || 0) + 1);
    }

    const topAreas = [...focusAreaMap.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
      .slice(0, 5)
      .map(([label, count]) => ({ label, count }));

    return {
      nodeCount: nodes.length,
      linkCount: links.length,
      weakCount,
      stableCount,
      avgScore,
      topAreas,
    };
  }, [filteredGraphData]);

  const activeGraph = filteredGraphData || { nodes: [], links: [] };

  // 节点集合变化时必须终止旧动画，避免筛选或切换领域后继续修改已经离开画布的对象。
  useEffect(() => stopNodeMotion, [activeGraph.nodes, stopNodeMotion]);

  const runNodeMotionFrame = useCallback(function runNodeMotionFrame(time) {
    const motion = nodeMotionRef.current;
    const motionConfig = motionConfigRef.current;
    const elapsed = motion.lastFrameTime == null ? 16.67 : Math.min(time - motion.lastFrameTime, 33.34);
    const frameScale = elapsed / 16.67;
    const damping = Math.pow(
      motion.draggedNodeId == null
        ? motionConfig.releasedDamping
        : motionConfig.draggingDamping,
      frameScale,
    );
    let hasMovingNode = false;
    const nodesById = new Map(activeGraph.nodes.map((node) => [node.id, node]));

    motion.lastFrameTime = time;

    for (const [nodeId, velocity] of motion.velocities) {
      const node = nodesById.get(nodeId);
      const origin = motion.origins.get(nodeId);

      if (!node || !origin) {
        motion.velocities.delete(nodeId);
        motion.origins.delete(nodeId);
        continue;
      }

      const nextPosition = getBoundedPosition(
        origin,
        node,
        velocity,
        frameScale,
        motionConfig.maxDisplacement,
      );
      node.x = nextPosition.x;
      node.y = nextPosition.y;

      const nextVelocity = { x: velocity.x * damping, y: velocity.y * damping };
      if (Math.hypot(nextVelocity.x, nextVelocity.y) > REPULSION_STOP_SPEED) {
        motion.velocities.set(nodeId, nextVelocity);
        hasMovingNode = true;
      } else {
        motion.velocities.delete(nodeId);
      }
    }

    if (hasMovingNode) {
      motion.frameId = requestAnimationFrame(runNodeMotionFrame);
      return;
    }

    // 多保留一个持续绘制帧，让本帧写入的最终坐标一定能落到 Canvas；若期间收到新冲量则直接续跑。
    motion.frameId = requestAnimationFrame((finalFrameTime) => {
      if (motion.velocities.size > 0) {
        runNodeMotionFrame(finalFrameTime);
        return;
      }

      motion.frameId = null;
      motion.lastFrameTime = null;
      if (motion.draggedNodeId == null) motion.origins.clear();
      setIsNodeMotionActive(false);
    });
  }, [activeGraph.nodes]);

  const ensureNodeMotionFrame = useCallback(() => {
    const motion = nodeMotionRef.current;
    if (motion.frameId == null) {
      motion.lastFrameTime = null;
      setIsNodeMotionActive(true);
      motion.frameId = requestAnimationFrame(runNodeMotionFrame);
    }
  }, [runNodeMotionFrame]);

  const handleNodeDrag = useCallback((draggedNode) => {
    // 直接按住节点拖动也视为选中，避免必须先单击一次、再进行第二次拖动才触发互斥反馈。
    if (draggedNode.id !== selectedNodeId) setSelectedNodeId(draggedNode.id);

    const motion = nodeMotionRef.current;
    if (motion.draggedNodeId == null) {
      motion.draggedNodeId = draggedNode.id;
      motion.origins.clear();
    }

    const motionConfig = motionConfigRef.current;
    let receivedImpulse = false;
    for (const nearbyNode of activeGraph.nodes) {
      if (nearbyNode.id === draggedNode.id) continue;

      const impulse = calculateRepulsionImpulse({
        draggedNode,
        nearbyNode,
        draggedRadius: getNodeRadius(draggedNode),
        nearbyRadius: getNodeRadius(nearbyNode),
        maxImpulse: motionConfig.maxImpulse,
      });
      if (impulse.strength === 0) continue;

      if (!motion.origins.has(nearbyNode.id)) {
        motion.origins.set(nearbyNode.id, { x: nearbyNode.x, y: nearbyNode.y });
      }
      const currentVelocity = motion.velocities.get(nearbyNode.id) || { x: 0, y: 0 };
      motion.velocities.set(nearbyNode.id, limitVector({
        x: currentVelocity.x + impulse.x,
        y: currentVelocity.y + impulse.y,
      }, motionConfig.maxSpeed));
      receivedImpulse = true;
    }

    if (receivedImpulse) ensureNodeMotionFrame();
  }, [activeGraph.nodes, ensureNodeMotionFrame, selectedNodeId]);

  const handleNodeDragEnd = useCallback((draggedNode) => {
    const motion = nodeMotionRef.current;
    if (motion.draggedNodeId !== draggedNode.id) return;

    motion.draggedNodeId = null;
    if (motion.velocities.size > 0) ensureNodeMotionFrame();
    else motion.origins.clear();
  }, [ensureNodeMotionFrame]);

  const selectionMeta = useMemo(() => {
    const connectedNodeIds = new Set();
    const connectedLinkKeys = new Set();

    if (selectedNodeId == null || !filteredGraphData?.links) {
      return { connectedNodeIds, connectedLinkKeys, relatedNodes: [] };
    }

    for (const link of filteredGraphData.links) {
      const sourceId = getEntityId(link.source);
      const targetId = getEntityId(link.target);
      if (sourceId !== selectedNodeId && targetId !== selectedNodeId) continue;

      connectedNodeIds.add(sourceId);
      connectedNodeIds.add(targetId);
      connectedLinkKeys.add(getLinkKey(sourceId, targetId));
    }

    const relatedNodes = filteredGraphData.nodes
      .filter((node) => node.id !== selectedNodeId && connectedNodeIds.has(node.id))
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);

    return { connectedNodeIds, connectedLinkKeys, relatedNodes };
  }, [filteredGraphData, selectedNodeId]);

  const paintNode = useCallback((node, ctx) => {
    const nodeId = node.id;
    const baseRadius = getNodeRadius(node);
    const selected = nodeId === selectedNodeId;
    const hovered = hoveredNode?.id === nodeId;
    const connected = selectionMeta.connectedNodeIds.has(nodeId);
    const dimmed = selectedNodeId != null && !selected && !connected;
    const color = scoreToColor(node.score);
    const isLight = !document.documentElement.classList.contains("dark");
    const textColor = isLight ? "#18181B" : "#FAFAF9";
    const radius = baseRadius + (selected ? 2.5 : hovered ? 1.2 : 0);
    const sway = getNodeSway(nodeId, performance.now(), selected || prefersReducedMotion);

    ctx.save();
    ctx.globalAlpha = dimmed ? 0.2 : 1;

    if (selected || hovered) {
      ctx.shadowColor = color;
      ctx.shadowBlur = selected ? 24 : 14;
    }

    // 形变始终以节点中心为原点，视觉摇摆不会污染力导向坐标、连线位置或点击命中区域。
    ctx.save();
    ctx.translate(node.x, node.y);
    ctx.rotate(sway.angle);
    if (sway.active) {
      // 动态虚线模拟掠过节点边缘的风痕，增强小尺寸节点上的可感知度，同时保持几何中心不动。
      ctx.save();
      ctx.globalAlpha *= 0.2 + Math.abs(sway.wind) * 0.045;
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.9;
      ctx.setLineDash([radius * 0.72, radius * 1.08]);
      ctx.lineDashOffset = sway.dashOffset;
      ctx.beginPath();
      ctx.ellipse(0, 0, radius + 3.4, radius + 2.4, sway.angle * 0.65, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.restore();
    }
    // 剪切与非等比缩放共同形成摇曳感；所有变换都围绕 (0, 0)，不会让节点中心漂移。
    ctx.transform(1, sway.shear, sway.shear * 0.32, 1, 0, 0);
    ctx.scale(sway.scaleX, sway.scaleY);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    if (selected || hovered) {
      ctx.strokeStyle = selected ? textColor : "rgba(250,250,249,0.85)";
      ctx.lineWidth = selected ? 2.2 : 1.4;
      ctx.stroke();
    }
    // 恢复 force-graph 当前的缩放和平移变换，确保标签仍在原始坐标系绘制。
    ctx.restore();
    ctx.shadowBlur = 0;

    const label = node.focus_area || truncate(node.question, 18);
    ctx.font = `${selected || hovered ? 12 : 10}px DM Sans, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillStyle = textColor;
    ctx.globalAlpha = dimmed ? 0.28 : selected || hovered ? 1 : 0.76;
    ctx.fillText(label, node.x, node.y - radius - 7);
    ctx.restore();
  }, [hoveredNode, prefersReducedMotion, selectedNodeId, selectionMeta.connectedNodeIds]);

  const paintLink = useCallback((link, ctx) => {
    const sourceId = getEntityId(link.source);
    const targetId = getEntityId(link.target);
    const selected = selectionMeta.connectedLinkKeys.has(getLinkKey(sourceId, targetId));
    const alphaBase = Math.max(0.08, (link.similarity - SIMILARITY_THRESHOLD) * 3);
    const alpha = selectedNodeId == null ? alphaBase : selected ? Math.max(alphaBase, 0.46) : 0.035;

    ctx.save();
    ctx.strokeStyle = selected ? `rgba(245,158,11,${alpha})` : `rgba(161,161,170,${alpha})`;
    ctx.lineWidth = selected ? 1.4 + link.similarity * 1.2 : 0.5 + link.similarity * 1.3;
    ctx.beginPath();
    ctx.moveTo(link.source.x, link.source.y);
    ctx.lineTo(link.target.x, link.target.y);
    ctx.stroke();
    ctx.restore();
  }, [selectedNodeId, selectionMeta.connectedLinkKeys]);

  const hoveredPreview = hoveredNode && hoveredNode.id !== selectedNodeId ? hoveredNode : null;

  const handleNodeClick = (node) => {
    setSelectedNodeId(node.id);
    fgRef.current?.centerAt(node.x, node.y, 400);
    fgRef.current?.zoom(Math.max(fgRef.current?.zoom?.() || 1, 2.1), 500);
  };

  const handleZoom = (factor) => {
    const graph = fgRef.current;
    if (!graph) return;
    const current = graph.zoom?.() || zoomLevel || 1;
    graph.zoom(clamp(current * factor, 0.45, 6), 250);
  };

  const handleZoomChange = useCallback(({ k }) => {
    // ForceGraph 可能在自身渲染阶段同步派发 onZoom；合并到下一帧可避免跨组件 render-phase 更新。
    if (zoomFrameRef.current != null) cancelAnimationFrame(zoomFrameRef.current);
    zoomFrameRef.current = requestAnimationFrame(() => {
      zoomFrameRef.current = null;
      setZoomLevel(roundScore(k));
    });
  }, []);

  const handleResetView = () => {
    setSelectedNodeId(null);
    fitGraphToView(filteredGraphData?.nodes || []);
  };

  const graphHasData = activeGraph.nodes.length > 0;
  const hasActiveFilters = searchQuery.trim() || scoreFilter !== "all" || areaFilter !== "all";
  // 数据返回后仍保持构建提示，直到力导向布局完成并适配好视口。
  // 图谱画布会在提示层背后完成准备，二者在同一次渲染中切换，避免中间空白造成闪烁。
  const graphIsBuilding = loading || Boolean(
    selectedTopic && graphData?.nodes?.length > 0 && !graphReady
  );

  useEffect(() => {
    const graph = fgRef.current;
    if (!graph) return;

    if (isGraphVisible) {
      graph.resumeAnimation?.();
      return;
    }

    // 页面或图谱不可见时，停止底层循环并丢弃旧动量，避免返回页面后节点突然继续位移。
    graph.pauseAnimation?.();
  }, [graphHasData, isGraphVisible]);

  return (
    <div ref={pageRef} className={PAGE_CLASS}>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <div className="text-3xl font-display font-bold tracking-tight md:text-4xl">题目图谱</div>
          <div className="mt-2 max-w-3xl text-sm leading-6 text-dim">
            这页不再只是展示气泡，而是用来定位薄弱题、查看关联题和决定下一步训练动作。
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <SummaryChip label="领域" value={topicEntries.length} hint="可切换" />
          <SummaryChip label="节点" value={graphInsights.nodeCount} hint={selectedTopic ? "当前筛选结果" : "待选择"} />
          <SummaryChip label="连接" value={graphInsights.linkCount} hint="语义相似" />
        </div>
      </div>

      <Card className="mt-4 border-border/80 bg-card/76">
        <CardContent className="p-4 md:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-text">领域切换</div>
              <div className="mt-1 text-sm text-dim">横向滚动切换，避免领域标签换行打散布局。</div>
            </div>
            <div className="rounded-full border border-border/80 bg-background/70 px-3 py-1 text-xs text-dim">
              当前支持拖拽、滚轮缩放、节点点击
            </div>
          </div>

          <div className="mt-4 -mx-1 overflow-x-auto pb-1">
            <div className="flex min-w-max gap-2 px-1">
              {topicEntries.map(([key, info]) => {
                const selected = selectedTopic === key;
                return (
                  <Button
                    key={key}
                    variant={selected ? "secondary" : "ghost"}
                    size="sm"
                    className={cn(
                      "h-10 rounded-full px-4",
                      selected
                        ? "border border-primary/60 bg-primary/14 text-text shadow-[0_0_0_1px_rgba(245,158,11,0.08)]"
                        : "border border-transparent hover:border-border/80"
                    )}
                    onClick={() => handleSelectTopic(key)}
                  >
                    <span className="mr-1.5 inline-flex align-middle">{getTopicIcon(info.icon, 14)}</span>
                    {info.name}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="mt-4 grid min-w-0 gap-3 xl:grid-cols-[minmax(280px,1fr)_280px_260px] 2xl:grid-cols-[minmax(360px,1fr)_280px_280px]">
            <Input
              className="w-full min-w-0"
              value={searchQuery}
              disabled={!selectedTopic}
              onChange={(event) => applyFilters(event.target.value, scoreFilter, areaFilter)}
              placeholder={selectedTopic ? "搜索题目或 focus area" : "先选择领域，再搜索题目"}
            />

            <div className="flex min-w-0 flex-nowrap gap-2 overflow-hidden">
              {SCORE_FILTERS.map((item) => (
                <Button
                  key={item.key}
                  variant={scoreFilter === item.key ? "secondary" : "ghost"}
                  size="sm"
                  className={cn(
                    "rounded-full px-4",
                    scoreFilter === item.key && "border border-primary/45 bg-primary/10 text-text"
                  )}
                  disabled={!selectedTopic}
                  onClick={() => applyFilters(searchQuery, item.key, areaFilter)}
                >
                  {item.label}
                </Button>
              ))}
            </div>

            <label className={cn(
              "flex w-full min-w-0 items-center justify-between gap-3 overflow-hidden rounded-2xl border border-border/80 bg-background/75 px-3 py-2.5 text-sm",
              !selectedTopic && "opacity-60"
            )}>
              <span className="shrink-0 text-dim">Focus Area</span>
              <select
                className="w-0 min-w-0 flex-1 truncate bg-transparent text-right text-text outline-none"
                value={areaFilter}
                disabled={!selectedTopic}
                onChange={(event) => applyFilters(searchQuery, scoreFilter, event.target.value)}
              >
                <option value="all">全部</option>
                {focusAreas.map((area) => (
                  <option key={area} value={area}>{area}</option>
                ))}
              </select>
            </label>
          </div>
        </CardContent>
      </Card>

      <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1.36fr)_380px] 2xl:grid-cols-[minmax(0,1.42fr)_400px]">
        <Card
          ref={containerRef}
          className="relative overflow-hidden rounded-[28px] border-border/80 bg-card/86"
          style={{ height: dimensions.height }}
        >
          <CardContent className="relative h-full p-0">
            {selectedTopic && graphHasData && (
              <>
                <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-[320px] rounded-[20px] border border-border/80 bg-background/82 px-4 py-3 shadow-sm backdrop-blur-sm">
                  <div className="text-sm font-semibold text-text">图例</div>
                  <div className="mt-2 space-y-2 text-xs leading-5 text-dim">
                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                      {[
                        { label: "待补题 <4", color: "bg-red" },
                        { label: "临界题 4-6", color: "bg-orange" },
                        { label: "熟悉题 6-8", color: "bg-primary" },
                        { label: "稳定题 8+", color: "bg-green" },
                      ].map((item) => (
                        <div key={item.label} className="flex items-center gap-1.5">
                          <span className={cn("inline-block h-2.5 w-2.5 rounded-full", item.color)} />
                          <span>{item.label}</span>
                        </div>
                      ))}
                    </div>
                    <div>节点越大，题目难度越高。线越亮，题目语义越接近。</div>
                    <div>滚轮缩放，拖动画布，点击节点锁定右侧详情。</div>
                  </div>
                </div>

                <div className="absolute right-3 top-3 z-10 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleZoom(0.82)}>缩小</Button>
                  <Button variant="outline" size="sm" onClick={() => handleZoom(1.22)}>放大</Button>
                  <Button variant="outline" size="sm" onClick={handleResetView}>适配视图</Button>
                </div>
              </>
            )}

            {!selectedTopic && (
              <EmptyGraphState
                title="先选择一个领域"
                description="图谱只展示某个训练领域下的关联题。先切换领域，再看题目之间的相似关系。"
              />
            )}

            {graphIsBuilding && (
              <div
                className="absolute inset-0 z-30 flex items-center justify-center gap-2 bg-card text-sm text-dim"
                role="status"
                aria-live="polite"
              >
                <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-dot" />
                <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-dot [animation-delay:0.2s]" />
                正在构建图谱...
              </div>
            )}

            {selectedTopic && !loading && graphData && graphData.nodes.length === 0 && (
              <EmptyGraphState
                title="该领域还没有图谱"
                description="当前还没有可用于建图的已评分专项训练题。先完成几次专项训练，再回来查看关联图谱。"
                action={(
                  <Button variant="gradient" onClick={() => navigate("/")}>
                    去开始专项训练
                  </Button>
                )}
              />
            )}

            {selectedTopic && !loading && graphData && graphData.nodes.length > 0 && !graphHasData && (
              <EmptyGraphState
                title="没有匹配的题目"
                description="当前搜索或筛选条件把所有节点都排除了。清空条件后再看全图。"
                action={(
                  <Button
                    variant="outline"
                    onClick={() => {
                      applyFilters("", "all", "all");
                    }}
                  >
                    清空筛选
                  </Button>
                )}
              />
            )}

            {selectedTopic && !loading && graphHasData && (
              <div className={graphReady ? "opacity-100" : "pointer-events-none opacity-0"}>
                <ForceGraph2D
                  ref={fgRef}
                  graphData={activeGraph}
                  width={dimensions.width}
                  height={dimensions.height}
                  backgroundColor="transparent"
                  // 装饰性摇摆需要持续绘制；减少动态效果时仅在拖拽排斥运行期间临时保持逐帧刷新。
                  autoPauseRedraw={!needsContinuousRedraw}
                  nodeCanvasObject={paintNode}
                  nodePointerAreaPaint={(node, color, ctx) => {
                    const radius = getNodeRadius(node) + 6;
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
                    ctx.fillStyle = color;
                    ctx.fill();
                  }}
                  linkCanvasObject={paintLink}
                  onNodeHover={setHoveredNode}
                  onNodeClick={handleNodeClick}
                  onNodeDrag={handleNodeDrag}
                  onNodeDragEnd={handleNodeDragEnd}
                  onBackgroundClick={() => setSelectedNodeId(null)}
                  onZoom={handleZoomChange}
                  onEngineStop={() => {
                    if (!initialFitPendingRef.current) return;
                    initialFitPendingRef.current = false;
                    fitGraphToView(activeGraph.nodes, 0);
                    revealFrameRef.current = requestAnimationFrame(() => {
                      revealFrameRef.current = null;
                      setGraphReady(true);
                    });
                  }}
                  // 初始阶段保留力导向布局计算；布局稳定并显示后，将后续模拟计算立即停止。
                  // react-force-graph 会在拖动节点时自动重新加热 simulation，如果继续执行 tick，
                  // 其他节点会被排斥力推离。设为 0 不影响被拖节点的坐标更新，只阻止其余节点重排。
                  cooldownTicks={graphReady ? 0 : 100}
                  d3AlphaDecay={0.026}
                  d3VelocityDecay={0.33}
                />
              </div>
            )}

            {hoveredPreview && graphHasData && (
              <div className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-[360px] rounded-[20px] border border-border/80 bg-background/84 px-4 py-3 shadow-lg backdrop-blur-sm">
                <div className="text-sm font-medium leading-6 text-text">{hoveredPreview.question}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-dim">
                  <ScorePill score={hoveredPreview.score} compact />
                  {hoveredPreview.focus_area && <Badge variant="outline">{hoveredPreview.focus_area}</Badge>}
                  {hoveredPreview.date && <span>{hoveredPreview.date}</span>}
                  <span>难度 {hoveredPreview.difficulty || 3}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div ref={detailsColumnRef} className="space-y-4">
          <Card className="rounded-[28px] border-border/80 bg-card/88">
            <CardContent className="p-5 md:p-6">
              <PanelHeader
                title={selectedNode ? "节点详情" : "图谱摘要"}
                caption={selectedNode
                  ? "点击空白处可取消选中。"
                  : "先从右侧看全局，再点击节点查看具体题目。"}
              />

              {selectedNode ? (
                <NodeDetailPanel
                  node={selectedNode}
                  relatedNodes={selectionMeta.relatedNodes}
                  zoomLevel={zoomLevel}
                  onOpenReview={() => selectedNode.session_id && navigate(`/review/${selectedNode.session_id}`)}
                  onClear={() => setSelectedNodeId(null)}
                />
              ) : (
                <GraphSummaryPanel
                  graphInsights={graphInsights}
                  selectedTopicInfo={selectedTopicInfo}
                  scoreFilter={scoreFilter}
                  areaFilter={areaFilter}
                  hasActiveFilters={Boolean(hasActiveFilters)}
                />
              )}
            </CardContent>
          </Card>

          <Card className="rounded-[28px] border-border/80 bg-card/88">
            <CardContent className="p-5 md:p-6">
              <PanelHeader
                title="操作提示"
                caption="把这张图当工作台，不是海报。"
              />

              <div className="mt-4 space-y-3 text-sm leading-6 text-text">
                <HintRow title="怎么读颜色" body="红色和橙色优先复盘，绿色表示已经相对稳定，黄色是还需要继续巩固的中间状态。" />
                <HintRow title="怎么用点击" body="点击节点后，右侧会显示题目详情、出现次数、推荐动作和最近一次复盘入口。" />
                <HintRow title="怎么收窄范围" body="优先用搜索 + 得分筛选，把图谱先压缩到你当前要处理的题目集合。" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SummaryChip({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-border/80 bg-card/82 px-3.5 py-2.5 backdrop-blur-sm">
      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-dim/80">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="text-xl font-semibold tracking-tight text-primary tabular-nums">{value}</div>
        <div className="text-xs text-dim">{hint}</div>
      </div>
    </div>
  );
}

function PanelHeader({ title, caption }) {
  return (
    <div>
      <div className="text-base font-semibold text-text">{title}</div>
      {caption && <div className="mt-1 text-sm leading-6 text-dim">{caption}</div>}
    </div>
  );
}

function EmptyGraphState({ title, description, action }) {
  return (
    <div className="flex min-h-[480px] items-center justify-center px-6 py-12">
      <div className="max-w-md rounded-[26px] border border-dashed border-border/80 bg-background/55 px-6 py-8 text-center">
        <div className="text-lg font-semibold text-text">{title}</div>
        <div className="mt-2 text-sm leading-6 text-dim">{description}</div>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  );
}

function GraphSummaryPanel({ graphInsights, selectedTopicInfo, scoreFilter, areaFilter, hasActiveFilters }) {
  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <MetricTile label="平均得分" value={graphInsights.avgScore != null ? `${graphInsights.avgScore}/10` : "--"} />
        <MetricTile label="待补题数" value={graphInsights.weakCount} valueClassName={graphInsights.weakCount ? "text-red" : "text-text"} />
        <MetricTile label="稳定题数" value={graphInsights.stableCount} valueClassName={graphInsights.stableCount ? "text-green" : "text-text"} />
        <MetricTile label="语义连接" value={graphInsights.linkCount} />
      </div>

      <div className="rounded-[22px] border border-border/80 bg-background/70 p-4">
        <div className="text-sm font-semibold text-text">当前上下文</div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-dim">
          <Badge variant="outline">{selectedTopicInfo?.name || "未选择领域"}</Badge>
          <Badge variant="outline">得分筛选 {buildScoreFilterLabel(scoreFilter)}</Badge>
          <Badge variant="outline">Focus Area {areaFilter === "all" ? "全部" : areaFilter}</Badge>
          {hasActiveFilters && <Badge variant="secondary">已启用筛选</Badge>}
        </div>
      </div>

      <div className="rounded-[22px] border border-border/80 bg-background/70 p-4">
        <div className="text-sm font-semibold text-text">高频 Focus Area</div>
        <div className="mt-3 space-y-2">
          {graphInsights.topAreas.length > 0 ? graphInsights.topAreas.map((item) => (
            <div key={item.label} className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate text-text">{item.label}</span>
              <Badge variant="secondary">{item.count}</Badge>
            </div>
          )) : (
            <div className="text-sm text-dim">选择领域后，这里会显示节点最集中的 focus area。</div>
          )}
        </div>
      </div>
    </div>
  );
}

function NodeDetailPanel({ node, relatedNodes, zoomLevel, onOpenReview, onClear }) {
  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-[22px] border border-border/80 bg-background/70 p-4">
        <div className="text-sm leading-7 text-text">{node.question}</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <ScorePill score={node.score} />
          <Badge variant="outline">平均 {node.avg_score}/10</Badge>
          <Badge variant="outline">最高 {node.best_score}/10</Badge>
          <Badge variant="outline">出现 {node.attempts || 1} 次</Badge>
          <Badge variant="outline">难度 {node.difficulty || 3}</Badge>
          {node.focus_area && <Badge variant="outline">{node.focus_area}</Badge>}
        </div>
        <div className="mt-3 text-xs text-dim">
          最近出现 {node.date || "--"} · 当前画布缩放 {zoomLevel}x
        </div>
      </div>

      <div className="rounded-[22px] border border-primary/20 bg-primary/8 p-4">
        <div className="text-sm font-semibold text-text">推荐动作</div>
        <div className="mt-2 text-sm leading-6 text-text">{buildNodeRecommendation(node)}</div>
      </div>

      <div className="rounded-[22px] border border-border/80 bg-background/70 p-4">
        <div className="text-sm font-semibold text-text">关联题</div>
        <div className="mt-3 space-y-2">
          {relatedNodes.length > 0 ? relatedNodes.map((item) => (
            <div key={item.id} className="rounded-2xl border border-border/70 bg-card/80 px-3 py-2.5">
              <div className="text-sm leading-6 text-text">{item.focus_area || truncate(item.question, 28)}</div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-dim">
                <span>{item.score}/10</span>
                {item.focus_area && <span>{item.focus_area}</span>}
              </div>
            </div>
          )) : (
            <div className="text-sm text-dim">当前节点没有达到阈值的相似题。</div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onClear}>取消选中</Button>
        {node.session_id && (
          <Button variant="gradient" onClick={onOpenReview}>
            查看最近一次复盘
          </Button>
        )}
      </div>
    </div>
  );
}

function MetricTile({ label, value, valueClassName = "text-primary" }) {
  return (
    <div className="rounded-[20px] border border-border/80 bg-background/70 px-4 py-3.5">
      <div className="text-xs text-dim">{label}</div>
      <div className={cn("mt-2 text-2xl font-semibold tracking-tight tabular-nums", valueClassName)}>{value}</div>
    </div>
  );
}

function HintRow({ title, body }) {
  return (
    <div className="rounded-[20px] border border-border/80 bg-background/70 px-4 py-3.5">
      <div className="text-sm font-semibold text-text">{title}</div>
      <div className="mt-1 text-sm leading-6 text-dim">{body}</div>
    </div>
  );
}

function ScorePill({ score, compact = false }) {
  if (score == null) {
    return <Badge variant="secondary">--</Badge>;
  }

  return (
    <Badge
      variant="outline"
      className={cn(
        "justify-center rounded-full border-transparent font-semibold",
        compact ? "px-2.5 py-0.5 text-[12px]" : "px-3 py-1 text-[13px]"
      )}
      style={{
        background: getScoreBg(score),
        color: scoreToColor(score),
      }}
    >
      {score}/10
    </Badge>
  );
}

function getNodeRadius(node) {
  return 6 + (node.difficulty || 3) * 1.35;
}

function matchesScoreFilter(node, filter) {
  if (filter === "all") return true;
  if (filter === "weak") return node.score < 4;
  if (filter === "mid") return node.score >= 4 && node.score < 8;
  if (filter === "strong") return node.score >= 8;
  return true;
}

function matchesGraphFilters(node, searchQuery, scoreFilter, areaFilter) {
  const query = searchQuery.trim().toLowerCase();
  const matchesQuery = !query
    || node.question.toLowerCase().includes(query)
    || (node.focus_area || "").toLowerCase().includes(query);
  const matchesArea = areaFilter === "all" || (node.focus_area || "") === areaFilter;
  return matchesQuery && matchesScoreFilter(node, scoreFilter) && matchesArea;
}

function buildScoreFilterLabel(filter) {
  return SCORE_FILTERS.find((item) => item.key === filter)?.label || "全部";
}

function buildNodeRecommendation(node) {
  if (node.score < 4) {
    return "这是明确的薄弱题。先看最近一次复盘，按复盘建议把答案重讲一遍，再补一题同 focus area 的题验证是否真的补上。";
  }
  if (node.score < 6) {
    return "这题处于临界区，不是完全不会，而是表达和结构还不稳定。建议先压缩成 1 分钟答案，再补充关键遗漏点。";
  }
  if (node.score < 8) {
    return "这题已经有基础，但还不够稳。建议把答案做成固定结构，重点补上反例、边界和工程取舍，防止下一次掉分。";
  }
  return "这题已经比较稳定，可以保留为优势模板。下一步不是继续磨同一题，而是用它去带动相邻题型，验证知识迁移。";
}

function getEntityId(value) {
  return typeof value === "object" ? value.id : value;
}

function getLinkKey(sourceId, targetId) {
  return sourceId < targetId ? `${sourceId}-${targetId}` : `${targetId}-${sourceId}`;
}

function truncate(value, maxLength = 32) {
  if (!value) return "";
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function roundScore(value) {
  const rounded = Number(Number(value).toFixed(1));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function scoreToColor(score) {
  if (score >= 8) return "#22C55E";
  if (score >= 6) return "#FBBF24";
  if (score >= 4) return "#FB923C";
  return "#EF4444";
}

function getScoreBg(score) {
  if (score >= 8) return "rgba(34,197,94,0.15)";
  if (score >= 6) return "rgba(245,158,11,0.15)";
  if (score >= 4) return "rgba(251,146,60,0.16)";
  return "rgba(239,68,68,0.15)";
}
