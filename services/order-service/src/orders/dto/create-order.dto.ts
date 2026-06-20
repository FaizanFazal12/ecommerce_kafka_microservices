import {
  IsArray,
  IsInt,
  IsPositive,
  IsString,
  IsUUID,
  ValidateNested,
  ArrayNotEmpty,
  IsOptional,
  Length,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateOrderItemDto {
  @IsUUID()
  productId!: string;

  @IsInt()
  @IsPositive()
  quantity!: number;

  @IsInt()
  @IsPositive()
  unitPriceCents!: number;
}

export class CreateOrderDto {
  @IsUUID()
  customerId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;
}
