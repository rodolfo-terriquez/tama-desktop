import { useState, useEffect, useCallback } from "react";
import { AppStatusDot } from "@/components/AppStatusDot";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Settings, BookOpen, Home, Library, History, Users, ChartColumn, RefreshCw, Cat } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import {
  checkForAppUpdatesManually,
  getAvailableAppUpdate,
  type AppUpdateCheckResult,
} from "@/services/updater";
import { useI18n } from "@/i18n";

interface AppSidebarProps {
  currentScreen: string;
  onNavigate: (screen: string) => void;
  senseiOpen: boolean;
  onToggleSensei: () => void;
}

export function AppSidebar({ currentScreen, onNavigate, senseiOpen, onToggleSensei }: AppSidebarProps) {
  const { t } = useI18n();
  const { isMobile, setOpenMobile } = useSidebar();
  const [appVersion, setAppVersion] = useState<string>("");
  const [availableUpdateVersion, setAvailableUpdateVersion] = useState<string | null>(null);
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const labelFadeClass =
    "group-data-[collapsible=icon]:[&>span:last-child]:opacity-0 [&>span:last-child]:transition-opacity [&>span:last-child]:duration-100";

  const handleSelectScreen = useCallback((screen: string) => {
    onNavigate(screen);
    if (isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile, onNavigate, setOpenMobile]);

  const handleToggleSensei = useCallback(() => {
    onToggleSensei();
    if (isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile, onToggleSensei, setOpenMobile]);

  useEffect(() => {
    getVersion()
      .then((v) => setAppVersion(v))
      .catch(() => setAppVersion(""));
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadAvailableUpdate = async () => {
      const result = await getAvailableAppUpdate();
      if (cancelled) return;

      if (result.status === "available") {
        setAvailableUpdateVersion(result.version ?? null);
        return;
      }

      setAvailableUpdateVersion(null);
    };

    void loadAvailableUpdate();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!updateMessage) return;

    const timeoutId = window.setTimeout(() => {
      setUpdateMessage(null);
    }, 5000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [updateMessage]);

  const handleUpdateCheck = useCallback(async () => {
    if (isCheckingForUpdates) return;

    setIsCheckingForUpdates(true);
    setUpdateMessage(null);

    let result: AppUpdateCheckResult;
    try {
      result = await checkForAppUpdatesManually();
    } finally {
      setIsCheckingForUpdates(false);
    }

    switch (result.status) {
      case "disabled":
        setUpdateMessage({ type: "error", text: result.message ?? t("sidebar.updaterDisabled") });
        break;
      case "up-to-date":
        setAvailableUpdateVersion(null);
        setUpdateMessage({
          type: "success",
          text: appVersion ? t("sidebar.upToDateVersion", { version: appVersion }) : t("sidebar.upToDate"),
        });
        break;
      case "declined":
        setAvailableUpdateVersion(result.version ?? availableUpdateVersion);
        setUpdateMessage({
          type: "success",
          text: result.version
            ? t("sidebar.updateAvailableVersion", { version: result.version })
            : t("sidebar.updateAvailable"),
        });
        break;
      case "installed":
        setAvailableUpdateVersion(null);
        setUpdateMessage({
          type: "success",
          text: result.version
            ? t("sidebar.updateInstalledVersion", { version: result.version })
            : t("sidebar.updateInstalled"),
        });
        break;
      case "error":
        setUpdateMessage({
          type: "error",
          text: result.message
            ? t("sidebar.updateFailedWithMessage", { message: result.message })
            : t("sidebar.updateFailed"),
        });
        break;
      default:
        setUpdateMessage(null);
    }
  }, [appVersion, availableUpdateVersion, isCheckingForUpdates, t]);

  const navItems = [
    {
      title: t("common.home"),
      icon: Home,
      id: "home",
      isActive: currentScreen === "home",
    },
    {
      title: t("common.scenarios"),
      icon: Library,
      id: "scenario-select",
      isActive: currentScreen === "scenario-select",
    },
    {
      title: t("common.personas"),
      icon: Users,
      id: "ongoing-chats",
      isActive: currentScreen === "ongoing-chats" || currentScreen === "ongoing-chat",
    },
    {
      title: t("common.flashcards"),
      icon: BookOpen,
      id: "flashcards",
      isActive: currentScreen === "flashcards",
    },
    {
      title: t("common.history"),
      icon: History,
      id: "history",
      isActive: currentScreen === "history",
    },
    {
      title: t("common.stats"),
      icon: ChartColumn,
      id: "stats",
      isActive: currentScreen === "stats",
    },
  ];

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup className="p-2">
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={senseiOpen}
                  onClick={handleToggleSensei}
                  tooltip={t("sensei.openChat")}
                  className={labelFadeClass}
                >
                  <Cat className="h-4 w-4" />
                  <span>{t("sensei.openChat")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem className="my-1 px-1">
                <div className="border-t border-sidebar-border" />
              </SidebarMenuItem>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    isActive={item.isActive}
                    onClick={() => handleSelectScreen(item.id)}
                    tooltip={item.title}
                    className={labelFadeClass}
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

      </SidebarContent>

      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="relative">
              <SidebarMenuButton
                isActive={currentScreen === "settings"}
                onClick={() => handleSelectScreen("settings")}
                tooltip={appVersion ? `${t("common.settings")} • v${appVersion}` : t("common.settings")}
                className={`min-w-0 flex-1 ${labelFadeClass}`}
              >
                <Settings className="h-4 w-4" />
                <span>{t("common.settings")}</span>
              </SidebarMenuButton>
              <AppStatusDot
                onClick={() => handleSelectScreen("settings")}
                className="absolute right-1 bottom-1 z-10"
              />
              {availableUpdateVersion && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={handleUpdateCheck}
                      disabled={isCheckingForUpdates}
                      className="absolute top-0 right-0 z-10 size-5 rounded-full p-0"
                    >
                      <RefreshCw className={isCheckingForUpdates ? "animate-spin size-3" : "size-3"} />
                      <span className="sr-only">
                        {isCheckingForUpdates ? t("sidebar.checking") : t("sidebar.update")}
                      </span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {t("sidebar.installUpdate", { version: availableUpdateVersion })}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
