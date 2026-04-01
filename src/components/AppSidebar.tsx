import { useCallback } from "react";
import tamaDarkIcon from "@/assets/tama-white.svg";
import tamaLightIcon from "@/assets/tama.svg";
import tamaPurpleIcon from "@/assets/tama-purple.svg";
import { AppStatusDot } from "@/components/AppStatusDot";
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
import { Settings, GalleryVerticalEnd, Home, Drama, History, UserRound, ChartColumn, SquareCheck } from "lucide-react";
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
  const isSenseiFullMode = currentScreen === "sensei";
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

  const navItems = [
    {
      title: t("common.home"),
      icon: Home,
      id: "home",
      isActive: currentScreen === "home",
    },
    {
      title: t("common.scenarios"),
      icon: Drama,
      id: "scenario-select",
      isActive: currentScreen === "scenario-select",
    },
    {
      title: t("common.personas"),
      icon: UserRound,
      id: "ongoing-chats",
      isActive: currentScreen === "ongoing-chats" || currentScreen === "ongoing-chat",
    },
    {
      title: t("common.flashcards"),
      icon: GalleryVerticalEnd,
      id: "flashcards",
      isActive: currentScreen === "flashcards",
    },
    {
      title: t("common.quizzes"),
      icon: SquareCheck,
      id: "quizzes",
      isActive: currentScreen === "quizzes" || currentScreen === "quiz",
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
        <SidebarGroup className="px-2 pt-[13px] pb-2.5">
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={isSenseiFullMode}
                  onClick={handleToggleSensei}
                  tooltip={t("sensei.openChat")}
                  className={labelFadeClass}
                >
                  {senseiOpen ? (
                    <img src={tamaPurpleIcon} alt="" className="h-4 w-4 shrink-0" />
                  ) : (
                    <>
                      <img src={tamaLightIcon} alt="" className="h-4 w-4 shrink-0 dark:hidden" />
                      <img src={tamaDarkIcon} alt="" className="hidden h-4 w-4 shrink-0 dark:block" />
                    </>
                  )}
                  <span>{t("sensei.openChat")}</span>
                </SidebarMenuButton>
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
                tooltip={t("common.settings")}
                className={`min-w-0 flex-1 ${labelFadeClass}`}
              >
                <Settings className="h-4 w-4" />
                <span>{t("common.settings")}</span>
              </SidebarMenuButton>
              <AppStatusDot
                onClick={() => handleSelectScreen("settings")}
                className="absolute right-1 bottom-1 z-10"
              />
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
