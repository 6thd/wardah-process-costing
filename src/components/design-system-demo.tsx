// Design System Demo Component
// This component demonstrates all the unified design system elements

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { 
  Calendar, 
  User, 
  Settings, 
  Bell, 
  Search,
  CheckCircle,
  AlertTriangle,
  Info,
  ChevronRight
} from "lucide-react"

export function DesignSystemDemo() {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold wardah-text-gradient-google">Design System Demo</h1>
        <p className="text-muted-foreground mt-2">
          This page demonstrates all the unified design system components
        </p>
      </div>

      {/* Cards Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="wardah-glass-card">
          <CardHeader>
            <CardTitle className="wardah-text-gradient-google">Glass Card Example</CardTitle>
            <CardDescription>Card with glassmorphism effect</CardDescription>
          </CardHeader>
          <CardContent>
            <p>This is a card with the new glassmorphism design.</p>
            <div className="flex gap-2 mt-4">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
            </div>
          </CardContent>
        </Card>

        <Card className="wardah-glass-card wardah-glass-card-hover">
          <CardHeader>
            <CardTitle className="wardah-text-gradient-google">Interactive Glass Card</CardTitle>
            <CardDescription>Card with hover effect</CardDescription>
          </CardHeader>
          <CardContent>
            <p>This card has a hover effect that lifts it up and adds shine.</p>
            <div className="flex items-center gap-2 mt-4">
              <CheckCircle className="text-green-500" />
              <span>Interactive element</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Form Elements */}
      <Card className="wardah-glass-card">
        <CardHeader>
          <CardTitle className="wardah-text-gradient-google">Form Elements</CardTitle>
          <CardDescription>Unified form components</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" placeholder="Enter your name" className="wardah-glass-card" />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" placeholder="Enter your email" className="wardah-glass-card" />
          </div>
          
          <div className="flex gap-2">
            <Button className="wardah-glass-card">
              <Search className="mr-2 h-4 w-4" />
              Search
            </Button>
            <Button variant="secondary" className="wardah-glass-card">
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Badges and Icons */}
      <Card className="wardah-glass-card">
        <CardHeader>
          <CardTitle className="wardah-text-gradient-google">Badges & Icons</CardTitle>
          <CardDescription>Visual indicators and icons</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 mb-4">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="destructive">Destructive</Badge>
            <Badge variant="outline">Outline</Badge>
          </div>
          
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <User className="text-blue-500" />
              <span>User</span>
            </div>
            <div className="flex items-center gap-2">
              <Settings className="text-green-500" />
              <span>Settings</span>
            </div>
            <div className="flex items-center gap-2">
              <Bell className="text-yellow-500" />
              <span>Notifications</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="text-purple-500" />
              <span>Calendar</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Status Indicators */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="wardah-glass-card">
          <CardContent className="flex items-center gap-3 p-4">
            <CheckCircle className="text-green-500 h-8 w-8" />
            <div>
              <h3 className="font-semibold">Success</h3>
              <p className="text-sm text-muted-foreground">Operation completed</p>
            </div>
          </CardContent>
        </Card>
        
        <Card className="wardah-glass-card">
          <CardContent className="flex items-center gap-3 p-4">
            <Info className="text-blue-500 h-8 w-8" />
            <div>
              <h3 className="font-semibold">Info</h3>
              <p className="text-sm text-muted-foreground">Informational message</p>
            </div>
          </CardContent>
        </Card>
        
        <Card className="wardah-glass-card">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertTriangle className="text-yellow-500 h-8 w-8" />
            <div>
              <h3 className="font-semibold">Warning</h3>
              <p className="text-sm text-muted-foreground">Attention required</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Animated Elements */}
      <Card className="wardah-glass-card">
        <CardHeader>
          <CardTitle className="wardah-text-gradient-google">Animated Elements</CardTitle>
          <CardDescription>Components with animations</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <div className="wardah-animation-float p-4 wardah-glass-card">
              <h3 className="font-semibold wardah-text-gradient-google">Floating Card</h3>
              <p className="text-sm text-muted-foreground">Subtle bouncing effect</p>
            </div>
            
            <div className="wardah-animation-gradient-shift p-4 wardah-glass-card">
              <h3 className="font-semibold wardah-text-gradient-google">Gradient Shift</h3>
              <p className="text-sm text-muted-foreground">Color transition effect</p>
            </div>
            
            <Button className="wardah-glass-card wardah-animation-float">
              <ChevronRight className="mr-2 h-4 w-4" />
              Animated Button
            </Button>
          </div>
          
          <div className="mt-6">
            <h4 className="font-medium mb-3 wardah-text-gradient-google">KPI Cards with Floating Animation</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="wardah-glass-card wardah-animation-float">
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold text-blue-500">24</div>
                  <div className="text-sm text-muted-foreground">Active Orders</div>
                </CardContent>
              </Card>
              
              <Card className="wardah-glass-card wardah-animation-float">
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold text-green-500">87%</div>
                  <div className="text-sm text-muted-foreground">Efficiency</div>
                </CardContent>
              </Card>
              
              <Card className="wardah-glass-card wardah-animation-float">
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold text-purple-500">12</div>
                  <div className="text-sm text-muted-foreground">Alerts</div>
                </CardContent>
              </Card>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}