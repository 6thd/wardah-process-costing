/**
 * Accounting Module Card Component
 * Extracted to reduce complexity in AccountingOverview
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { LucideIcon } from 'lucide-react';

interface ModuleCardProps {
  title: string;
  description: string;
  icon: LucideIcon;
  href: string;
  color: string;
  bgColor: string;
  features: string[];
  isRTL: boolean;
}

export function ModuleCard({
  title,
  description,
  icon: Icon,
  href,
  color,
  bgColor,
  features,
  isRTL
}: ModuleCardProps) {
  const navigate = useNavigate();

  return (
    <Card 
      className="hover:shadow-lg transition-shadow cursor-pointer group"
      onClick={() => navigate(href)}
    >
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className={`p-3 rounded-lg ${bgColor}`}>
            <Icon className={`h-6 w-6 ${color}`} />
          </div>
        </div>
        <CardTitle className="mt-4">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm text-muted-foreground">
          {features.map((feature, index) => (
            <li key={index} className="flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-primary" />
              {feature}
            </li>
          ))}
        </ul>
        <Button 
          className="w-full mt-4" 
          variant="outline"
          onClick={(e) => {
            e.stopPropagation();
            navigate(href);
          }}
        >
          {isRTL ? 'فتح' : 'Open'}
        </Button>
      </CardContent>
    </Card>
  );
}
