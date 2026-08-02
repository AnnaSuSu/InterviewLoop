import { cn } from "@/resume/lib/utils";
import { useResumeStore } from "@/resume/store/useResumeStore";
import { Reorder } from "framer-motion";
import { PlusCircle } from "lucide-react";
import { useTranslations } from "@/resume/i18n/compat/client";
import { Button } from "@/resume/ui/button";
import ProjectItem from "./ProjectItem";
import { Project } from "@/resume/types/resume";
import { generateUUID } from "@/resume/utils/uuid";

const ProjectPanel = () => {
  const t = useTranslations("workbench.projectPanel");
  const { activeResume, updateProjects, updateProjectsBatch } =
    useResumeStore();
  const { projects = [] } = activeResume || {};
  const handleCreateProject = () => {
    const newProject: Project = {
      id: generateUUID(),
      name: t("defaultProject.name"),
      role: t("defaultProject.role"),
      date: t("defaultProject.date"),
      description: t("defaultProject.description"),
      visible: true,
    };
    updateProjects(newProject);
  };

  return (
    <div
      className={cn(
        "space-y-4 px-4 py-4 rounded-lg",
        "bg-card border-border",
      )}
    >
      <Reorder.Group
        axis="y"
        values={projects}
        onReorder={(newOrder) => {
          updateProjectsBatch(newOrder);
        }}
        className="space-y-3"
      >
        {projects.map((project) => (
          <ProjectItem key={project.id} project={project}></ProjectItem>
        ))}

        <Button onClick={handleCreateProject} className="w-full">
          <PlusCircle className="w-4 h-4 mr-2" />
          {t("addButton")}
        </Button>
      </Reorder.Group>
    </div>
  );
};

export default ProjectPanel;
